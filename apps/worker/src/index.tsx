import { Fragment } from "react";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { renderToStaticMarkup } from "react-dom/server";
import {
  safeURL,
  hash,
  passwordHash,
  constantEqual,
  escapeXML,
} from "./security.mjs";
type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_NAME: string;
  ALLOWED_DOWNLOAD_HOSTS: string;
  BOOTSTRAP_TOKEN: string;
  BOOTSTRAP_ENABLED: string;
};
const app = new Hono<{ Bindings: Env; Variables: { admin: any } }>();
const now = () => Math.floor(Date.now() / 1000),
  id = () => crypto.randomUUID();
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https:", "data:"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'none'"],
    },
  }),
);
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 262144,
    onError: (c) => c.json({ error: "Request too large" }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    c.req.header("Origin") !== new URL(c.req.url).origin
  )
    return c.json({ error: "Same-origin request required" }, 403);
  if (Number(c.req.header("Content-Length") || 0) > 262144)
    return c.json({ error: "Request too large" }, 413);
  await next();
});
app.onError((e, c) => {
  if (e instanceof z.ZodError || e instanceof SyntaxError)
    return c.json({ error: "Invalid request" }, 400);
  console.error(JSON.stringify({ event: "request_error", type: e.name }));
  return c.json({ error: "Request failed" }, 500);
});
async function read(c: any, schema: any) {
  const text = await c.req.text();
  if (text.length > 262144) throw new Error("Request too large");
  return schema.parse(JSON.parse(text));
}
async function throttle(db: D1Database, key: string, limit: number) {
  const t = now();
  await db
    .prepare(
      "INSERT INTO auth_attempts(id,count,window_start) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN window_start<? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<? THEN ? ELSE window_start END",
    )
    .bind(key, t, t - 900, t - 900, t)
    .run();
  const row: any = await db
    .prepare("SELECT count FROM auth_attempts WHERE id=?")
    .bind(key)
    .first();
  return row.count <= limit;
}
app.use("/api/v1/admin/*", async (c, next) => {
  if (c.req.path.endsWith("/login") || c.req.path.endsWith("/bootstrap"))
    return next();
  const token = getCookie(c, "cw_session");
  if (!token) return c.json({ error: "Login required" }, 401);
  const admin = await c.env.DB.prepare(
    "SELECT a.id,a.email,a.role FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id=? AND s.expires_at>?",
  )
    .bind(await hash(token), now())
    .first();
  if (!admin) return c.json({ error: "Session expired" }, 401);
  c.set("admin", admin);
  await next();
});
const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(14).max(128),
});
app.post("/api/v1/admin/bootstrap", async (c) => {
  if (
    c.env.BOOTSTRAP_ENABLED !== "true" ||
    !c.env.BOOTSTRAP_TOKEN ||
    !constantEqual(
      c.req.header("Authorization") || "",
      `Bearer ${c.env.BOOTSTRAP_TOKEN}`,
    )
  )
    return c.json({ error: "Bootstrap disabled" }, 403);
  const body = await read(c, credentials);
  const salt = id();
  const result = await c.env.DB.prepare(
    "INSERT INTO admins(id,email,password_hash,salt,role) SELECT ?,?,?,?,'owner' WHERE NOT EXISTS (SELECT 1 FROM admins)",
  )
    .bind(id(), body.email, await passwordHash(body.password, salt), salt)
    .run();
  return c.json(
    { created: result.meta.changes === 1 },
    result.meta.changes === 1 ? 201 : 409,
  );
});
app.post("/api/v1/admin/login", async (c) => {
  if (
    !(await throttle(
      c.env.DB,
      "login:" + (await hash(c.req.header("CF-Connecting-IP") || "local")),
      10,
    ))
  )
    return c.json({ error: "Try again later" }, 429);
  const b = await read(c, credentials);
  const a: any = await c.env.DB.prepare("SELECT * FROM admins WHERE email=?")
    .bind(b.email)
    .first();
  const candidate = await passwordHash(
    b.password,
    a?.salt || "missing-account-salt",
  );
  if (!a || !constantEqual(candidate, a.password_hash))
    return c.json({ error: "Invalid credentials" }, 401);
  const token = id() + id();
  await c.env.DB.prepare(
    "INSERT INTO admin_sessions(id,admin_id,expires_at) VALUES (?,?,?)",
  )
    .bind(await hash(token), a.id, now() + 28800)
    .run();
  setCookie(c, "cw_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: 28800,
  });
  return c.json({ ok: true });
});
app.post("/api/v1/admin/logout", async (c) => {
  await c.env.DB.prepare("DELETE FROM admin_sessions WHERE id=?")
    .bind(await hash(getCookie(c, "cw_session") || ""))
    .run();
  deleteCookie(c, "cw_session", { path: "/", secure: true });
  return c.json({ ok: true });
});
app.get("/api/v1/admin/me", (c) => c.json({ data: c.get("admin") }));
const movieSchema = z.object({
  title: z.string().min(1).max(250),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(240),
  synopsis: z.string().max(10000).default(""),
  poster: z.union([z.literal(""), z.url().startsWith("https://")]).default(""),
  release_year: z.number().int().min(1880).max(2100),
  release_date: z.string().max(20).default(""),
  cast_names: z.string().max(2000).default(""),
  director: z.string().max(250).default(""),
  runtime: z.number().int().positive().nullable().default(null),
  seo_title: z.string().max(250).default(""),
  meta_description: z.string().max(500).default(""),
  status: z.enum(["draft", "published"]).default("draft"),
});
const fileSchema = z.object({
  movie_id: z.string(),
  resolution: z.enum(["480p", "720p", "1080p", "2160p"]),
  codec: z.string().min(1).max(30),
  bytes: z.number().int().positive(),
  audio: z.string().min(1).max(200),
  subtitles: z.string().max(200).default(""),
  format: z.string().min(1).max(20),
  checksum: z
    .string()
    .regex(/^$|^[a-f0-9]{64}$/)
    .default(""),
  enabled: z.number().int().min(0).max(1).default(0),
  sort_order: z.number().int().default(0),
});
const mirrorSchema = z.object({
  file_id: z.string(),
  label: z.string().min(1).max(80),
  url: z.url(),
  enabled: z.number().int().min(0).max(1).default(0),
  expires_at: z.number().int().nullable().default(null),
});
async function audit(c: any, action: string, target: string) {
  await c.env.DB.prepare(
    "INSERT INTO audit_logs(id,admin_id,action,target) VALUES (?,?,?,?)",
  )
    .bind(id(), c.get("admin").id, action, target)
    .run();
}
for (const [resource, table, schema] of [
  ["movies", "movies", movieSchema],
  ["files", "movie_files", fileSchema],
  ["mirrors", "download_mirrors", mirrorSchema],
  [
    "categories",
    "categories",
    z.object({
      name: z.string().min(1).max(80),
      slug: z.string().regex(/^[a-z0-9-]+$/),
    }),
  ],
  ["settings", "site_settings", z.object({ value: z.string().max(10000) })],
] as const) {
  app.get(`/api/v1/admin/${resource}`, async (c) => {
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    return c.json({
      data: (
        await c.env.DB.prepare(
          `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 50 OFFSET ?`,
        )
          .bind((page - 1) * 50)
          .all()
      ).results,
    });
  });
  app.get(`/api/v1/admin/${resource}/:id`, async (c) => {
    const data = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`)
      .bind(c.req.param("id"))
      .first();
    return data ? c.json({ data }) : c.json({ error: "Not found" }, 404);
  });
  const save = async (c: any, update: boolean) => {
    let body;
    try {
      body = await read(c, schema);
    } catch {
      return c.json({ error: "Invalid input" }, 400);
    }
    if (
      resource === "mirrors" &&
      !safeURL(body.url, c.env.ALLOWED_DOWNLOAD_HOSTS)
    )
      return c.json({ error: "Host not approved; HTTPS required" }, 400);
    const key = update ? c.req.param("id") : id();
    const columns = Object.keys(body);
    if (update)
      await c.env.DB.prepare(
        `UPDATE ${table} SET ${columns.map((k) => `${k}=?`).join(",")},updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      )
        .bind(...Object.values(body), key)
        .run();
    else
      await c.env.DB.prepare(
        `INSERT INTO ${table}(id,${columns.join(",")}) VALUES (${["?", ...columns.map(() => "?")].join(",")})`,
      )
        .bind(key, ...Object.values(body))
        .run();
    await audit(c, `${resource}.${update ? "update" : "create"}`, key);
    return c.json({ id: key }, update ? 200 : 201);
  };
  app.post(`/api/v1/admin/${resource}`, (c) => save(c, false));
  app.put(`/api/v1/admin/${resource}/:id`, (c) => save(c, true));
  app.delete(`/api/v1/admin/${resource}/:id`, async (c) => {
    await c.env.DB.prepare(`DELETE FROM ${table} WHERE id=?`)
      .bind(c.req.param("id"))
      .run();
    await audit(c, `${resource}.delete`, c.req.param("id"));
    return c.json({ ok: true });
  });
}

app.get("/api/v1/admin/dashboard", async (c) => {
  const tables = [
    "movies",
    "movie_files",
    "download_events",
    "copyright_reports",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const r: any = await c.env.DB.prepare(
      `SELECT count(*) AS total FROM ${t}`,
    ).first();
    counts[t] = r.total;
  }
  const published: any = await c.env.DB.prepare(
    "SELECT count(*) AS total FROM movies WHERE status='published'",
  ).first();
  const broken: any = await c.env.DB.prepare(
    "SELECT count(*) AS total FROM download_mirrors WHERE health='broken'",
  ).first();
  return c.json({
    data: {
      ...counts,
      published: published.total,
      drafts: counts.movies - published.total,
      broken: broken.total,
    },
  });
});
app.get("/api/v1/admin/reports", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT * FROM copyright_reports ORDER BY created_at DESC LIMIT 100",
      ).all()
    ).results,
  }),
);
app.get("/api/v1/admin/ads", async (c) =>
  c.json({
    data: (await c.env.DB.prepare("SELECT * FROM ad_placements").all()).results,
  }),
);
app.put("/api/v1/admin/ads/:id", async (c) => {
  if (c.get("admin").role !== "owner")
    return c.json({ error: "Owner required" }, 403);
  const b = await read(
    c,
    z.object({ enabled: z.number().int().min(0).max(1) }),
  );
  await c.env.DB.prepare("UPDATE ad_placements SET enabled=? WHERE id=?")
    .bind(b.enabled, c.req.param("id"))
    .run();
  await audit(c, "ad.update", c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/v1/admin/movies/:id/duplicate", async (c) => {
  const original: any = await c.env.DB.prepare(
    "SELECT * FROM movies WHERE id=?",
  )
    .bind(c.req.param("id"))
    .first();
  if (!original) return c.json({ error: "Not found" }, 404);
  const key = id();
  const body = movieSchema.parse({
    ...original,
    title: original.title + " (Copy)",
    slug: original.slug + "-copy-" + key.slice(0, 8),
    status: "draft",
  });
  await c.env.DB.prepare(
    `INSERT INTO movies(id,${Object.keys(body).join(",")}) VALUES (${["?", ...Object.keys(body).map(() => "?")].join(",")})`,
  )
    .bind(key, ...Object.values(body))
    .run();
  await audit(c, "movie.duplicate", key);
  return c.json({ id: key }, 201);
});
app.put("/api/v1/admin/movies/:id/taxonomy", async (c) => {
  const b = await read(
    c,
    z.object({
      categories: z.array(z.string()).max(20),
      genres: z.array(z.string().min(1).max(100)).max(20),
      languages: z.array(z.string().min(1).max(100)).max(20),
    }),
  );
  const movie = c.req.param("id");
  const statements: D1PreparedStatement[] = [];
  for (const table of ["movie_categories", "movie_genres", "movie_languages"])
    statements.push(
      c.env.DB.prepare(`DELETE FROM ${table} WHERE movie_id=?`).bind(movie),
    );
  for (const cat of b.categories)
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO movie_categories(movie_id,category_id) VALUES (?,?)",
      ).bind(movie, cat),
    );
  for (const [items, table, join, column] of [
    [b.genres, "genres", "movie_genres", "genre_id"],
    [b.languages, "languages", "movie_languages", "language_id"],
  ] as const)
    for (const name of items) {
      statements.push(
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO ${table}(id,name) VALUES (?,?)`,
        ).bind(id(), name),
      );
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO ${join}(movie_id,${column}) SELECT ?,id FROM ${table} WHERE name=?`,
        ).bind(movie, name),
      );
    }
  await c.env.DB.batch(statements);
  await audit(c, "movie.taxonomy", movie);
  return c.json({ ok: true });
});
app.put("/api/v1/admin/bulk-categories", async (c) => {
  const b = await read(
    c,
    z.object({
      movie_ids: z.array(z.string()).min(1).max(50),
      category_id: z.string(),
    }),
  );
  await c.env.DB.batch(
    b.movie_ids.map((movie: string) =>
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO movie_categories(movie_id,category_id) VALUES (?,?)",
      ).bind(movie, b.category_id),
    ),
  );
  await audit(c, "movie.bulk-category", b.category_id);
  return c.json({ ok: true });
});
app.put("/api/v1/admin/movies/:id/screenshots", async (c) => {
  const b = await read(
    c,
    z.object({
      screenshots: z
        .array(
          z.object({
            url: z.url().startsWith("https://"),
            alt: z.string().min(1).max(250),
          }),
        )
        .max(12),
    }),
  );
  const movie = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM screenshots WHERE movie_id=?").bind(movie),
    ...b.screenshots.map((shot: any, i: number) =>
      c.env.DB.prepare(
        "INSERT INTO screenshots(id,movie_id,url,alt,sort_order) VALUES (?,?,?,?,?)",
      ).bind(id(), movie, shot.url, shot.alt, i),
    ),
  ]);
  await audit(c, "movie.screenshots", movie);
  return c.json({ ok: true });
});
app.put("/api/v1/admin/movies/:id/rights", async (c) => {
  if (c.get("admin").role !== "owner")
    return c.json({ error: "Owner required" }, 403);
  const b = await read(
    c,
    z.object({
      status: z.enum(["pending", "verified", "revoked"]),
      license: z.string().min(1).max(2000),
      evidence_url: z.url().startsWith("https://"),
    }),
  );
  await c.env.DB.prepare(
    "INSERT INTO rights_records(id,movie_id,status,license,evidence_url,verified_by,verified_at) VALUES (?,?,?,?,?,?,datetime('now')) ON CONFLICT(movie_id) DO UPDATE SET status=excluded.status,license=excluded.license,evidence_url=excluded.evidence_url,verified_by=excluded.verified_by,verified_at=excluded.verified_at",
  )
    .bind(
      id(),
      c.req.param("id"),
      b.status,
      b.license,
      b.evidence_url,
      c.get("admin").id,
    )
    .run();
  await audit(c, "rights.update", c.req.param("id"));
  return c.json({ ok: true });
});
async function catalog(c: any, sort = "latest", categoryOverride?: string) {
  const q = {
    ...c.req.query(),
    ...(categoryOverride ? { category: categoryOverride } : {}),
  };
  const where = ["m.status='published'"];
  const args: any[] = [];
  if (q.q) {
    const tokens = q.q.slice(0, 100).match(/[\p{L}\p{N}]+/gu) || [];
    where.push(
      tokens.length
        ? "m.rowid IN (SELECT rowid FROM movies_search WHERE movies_search MATCH ?)"
        : "0=1",
    );
    if (tokens.length)
      args.push(tokens.map((t: string) => '"' + t + '"*').join(" AND "));
  }
  if (q.year) {
    where.push("m.release_year=?");
    args.push(Number(q.year));
  }
  if (q.category) {
    where.push(
      "EXISTS(SELECT 1 FROM movie_categories mc JOIN categories cat ON cat.id=mc.category_id WHERE mc.movie_id=m.id AND cat.slug=?)",
    );
    args.push(q.category);
  }
  if (q.language) {
    where.push(
      "EXISTS(SELECT 1 FROM movie_languages ml JOIN languages l ON l.id=ml.language_id WHERE ml.movie_id=m.id AND l.name=?)",
    );
    args.push(q.language);
  }
  if (q.quality) {
    where.push(
      "EXISTS(SELECT 1 FROM movie_files f WHERE f.movie_id=m.id AND f.enabled=1 AND f.resolution=?)",
    );
    args.push(q.quality);
  }
  const page = Math.min(10000, Math.max(1, parseInt(q.page) || 1));
  const order =
    sort === "popular"
      ? "(SELECT count(*) FROM download_events e JOIN movie_files f ON f.id=e.file_id WHERE f.movie_id=m.id) DESC"
      : sort === "updated"
        ? "m.updated_at DESC"
        : "m.created_at DESC";
  const data = await c.env.DB.prepare(
    `SELECT m.*,(SELECT group_concat(DISTINCT f.resolution) FROM movie_files f JOIN rights_records r ON r.movie_id=f.movie_id WHERE f.movie_id=m.id AND f.enabled=1 AND r.status='verified') AS qualities,(SELECT group_concat(l.name) FROM languages l JOIN movie_languages ml ON ml.language_id=l.id WHERE ml.movie_id=m.id) AS audio_languages FROM movies m WHERE ${where.join(" AND ")} ORDER BY ${order},m.id LIMIT 24 OFFSET ?`,
  )
    .bind(...args, (page - 1) * 24)
    .all();
  return { data: data.results, page, pageSize: 24 };
}
app.get("/api/v1/categories", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare("SELECT * FROM categories ORDER BY name").all()
    ).results,
  }),
);
for (const path of ["movies", "search", "movies/latest", "movies/popular"])
  app.get("/api/v1/" + path, async (c) =>
    c.json(await catalog(c, path.endsWith("popular") ? "popular" : "latest")),
  );
async function detail(db: D1Database, slug: string, allowed: string) {
  const movie: any = await db
    .prepare(
      "SELECT m.*,r.status AS rights_status,r.license FROM movies m LEFT JOIN rights_records r ON r.movie_id=m.id WHERE m.slug=? AND m.status='published'",
    )
    .bind(slug)
    .first();
  if (!movie) return null;
  for (const [field, table, join, column] of [
    ["categories", "categories", "movie_categories", "category_id"],
    ["genres", "genres", "movie_genres", "genre_id"],
    ["languages", "languages", "movie_languages", "language_id"],
  ])
    movie[field] = (
      await db
        .prepare(
          `SELECT t.name FROM ${table} t JOIN ${join} j ON j.${column}=t.id WHERE j.movie_id=?`,
        )
        .bind(movie.id)
        .all()
    ).results.map((x: any) => x.name);
  movie.files =
    movie.rights_status === "verified"
      ? (
          await db
            .prepare(
              "SELECT id,resolution,codec,bytes,audio,subtitles,format,checksum,enabled FROM movie_files WHERE movie_id=? ORDER BY sort_order",
            )
            .bind(movie.id)
            .all()
        ).results
      : [];
  movie.screenshots = (
    await db
      .prepare(
        "SELECT url,alt FROM screenshots WHERE movie_id=? ORDER BY sort_order",
      )
      .bind(movie.id)
      .all()
  ).results;
  for (const file of movie.files) {
    const mirrors = await db
      .prepare(
        "SELECT id,label,url,enabled,expires_at FROM download_mirrors WHERE file_id=? ORDER BY created_at",
      )
      .bind(file.id)
      .all();
    file.mirrors = mirrors.results.map((m: any) => ({
      id: m.id,
      label: m.label,
      available:
        !!file.enabled &&
        !!m.enabled &&
        (!m.expires_at || m.expires_at > now()) &&
        !!safeURL(m.url, allowed),
    }));
  }
  return movie;
}
app.get("/api/v1/movies/:slug", async (c) => {
  const data = await detail(
    c.env.DB,
    c.req.param("slug"),
    c.env.ALLOWED_DOWNLOAD_HOSTS,
  );
  return data ? c.json({ data }) : c.json({ error: "Not found" }, 404);
});
app.get("/api/v1/downloads/:fileId", async (c) => {
  if (
    !(await throttle(
      c.env.DB,
      "download:" + (await hash(c.req.header("CF-Connecting-IP") || "local")),
      100,
    ))
  )
    return c.json({ error: "Try later" }, 429);
  const mirrors = await c.env.DB.prepare(
    "SELECT d.* FROM download_mirrors d JOIN movie_files f ON f.id=d.file_id JOIN movies m ON m.id=f.movie_id JOIN rights_records r ON r.movie_id=m.id WHERE f.id=? AND f.enabled=1 AND d.enabled=1 AND m.status='published' AND r.status='verified' AND (d.expires_at IS NULL OR d.expires_at>?) AND (? IS NULL OR d.id=?) ORDER BY d.created_at",
  )
    .bind(
      c.req.param("fileId"),
      now(),
      c.req.query("mirror") || null,
      c.req.query("mirror") || null,
    )
    .all();
  for (const mirror of mirrors.results) {
    const url = safeURL(mirror.url, c.env.ALLOWED_DOWNLOAD_HOSTS);
    if (!url) continue;
    await c.env.DB.prepare(
      "INSERT INTO download_events(id,file_id,mirror_id) VALUES (?,?,?)",
    )
      .bind(id(), c.req.param("fileId"), mirror.id)
      .run();
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(url, 302);
  }
  return c.json({ error: "No authorized download available" }, 404);
});
app.post("/api/v1/reports", async (c) => {
  if (
    !(await throttle(
      c.env.DB,
      "report:" + (await hash(c.req.header("CF-Connecting-IP") || "local")),
      5,
    ))
  )
    return c.json({ error: "Try later" }, 429);
  const b = await read(
    c,
    z.object({
      email: z.email(),
      message: z.string().min(20).max(5000),
      movie_id: z.string().nullable().default(null),
    }),
  );
  await c.env.DB.prepare(
    "INSERT INTO copyright_reports(id,email,message,movie_id) VALUES (?,?,?,?)",
  )
    .bind(id(), b.email, b.message, b.movie_id)
    .run();
  return c.json({ ok: true }, 201);
});
app.post("/report", bodyLimit({ maxSize: 16384 }), async (c) => {
  if (c.req.header("Origin") !== new URL(c.req.url).origin)
    return c.text("Same-origin request required", 403);
  if (
    !(await throttle(
      c.env.DB,
      "report:" + (await hash(c.req.header("CF-Connecting-IP") || "local")),
      5,
    ))
  )
    return c.text("Try again later", 429);
  const parsed = z
    .object({ email: z.email(), message: z.string().min(20).max(5000) })
    .safeParse(await c.req.parseBody());
  if (!parsed.success)
    return c.text(
      "Please provide a valid email and a report of 20–5000 characters.",
      400,
    );
  await c.env.DB.prepare(
    "INSERT INTO copyright_reports(id,email,message) VALUES (?,?,?)",
  )
    .bind(id(), parsed.data.email, parsed.data.message)
    .run();
  return c.redirect("/report-received", 303);
});
const css = `*{box-sizing:border-box}body{margin:0;background:#0c111b;color:#e7edf7;font:16px/1.6 system-ui}a{color:inherit;text-decoration:none}header{border-bottom:1px solid #283345;padding:20px 6%;display:flex;gap:30px;align-items:center;flex-wrap:wrap}.logo{font-size:24px;font-weight:800;color:#61e6b4}main{max-width:1200px;margin:auto;padding:40px 24px}.eyebrow{color:#61e6b4;letter-spacing:3px;font-size:12px}h1{font-size:clamp(30px,5vw,56px);line-height:1.12}p{color:#aebbd0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:24px}.card{background:#151e2d;border:1px solid #29364a;border-radius:14px;overflow:hidden}.poster{aspect-ratio:2/3;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,#253953,#15231f);font-size:56px;color:#61e6b4}.card img{width:100%;aspect-ratio:2/3;object-fit:cover}.info{padding:18px}.badge{background:#203b34;color:#83ebc8;border-radius:5px;padding:4px 8px;font-size:12px}.filters{display:flex;gap:10px;flex-wrap:wrap;margin:30px 0}input,select,textarea{background:#151e2d;color:white;border:1px solid #40516d;padding:12px;border-radius:7px;max-width:100%}button,.button{background:#61e6b4;color:#0c111b;border:0;padding:12px 20px;border-radius:7px;display:inline-block;cursor:pointer}footer{border-top:1px solid #283345;padding:30px 6%;color:#aebbd0}section{margin:36px 0}.detail{display:grid;grid-template-columns:minmax(150px,280px) 1fr;gap:36px}dt{color:#aebbd0}dd{margin:0 0 12px}nav{display:flex;gap:18px;flex-wrap:wrap}@media(max-width:600px){.detail{grid-template-columns:1fr}.detail .poster{max-width:250px}.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.info{padding:10px}}`;
function Layout({
  name,
  title,
  description,
  canonical,
  children,
  structured,
  placements,
}: any) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{`${title} | ${name}`}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <style>{css}</style>
        {structured && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(structured).replace(/</g, "\\u003c"),
            }}
          />
        )}
      </head>
      <body>
        <header>
          <a className="logo" href="/">
            ◉ {name}
          </a>
          <nav>
            <a href="/">Discover</a>
            <a href="/categories">Categories</a>
            <a href="/legal">Rights & help</a>
          </nav>
        </header>
        <main>
          {placements?.map((ad: any) => (
            <aside
              key={ad.id}
              aria-label={ad.label}
              style={{
                padding: 24,
                border: "1px dashed #40516d",
                margin: "16px 0",
                color: "#aebbd0",
              }}
            >
              Advertisement · {ad.label}
            </aside>
          ))}
          {children}
        </main>
        <footer>
          <nav>
            <a href="/">Home</a>
            <a href="/legal">Terms · Privacy · Copyright reports</a>
          </nav>
          <p>
            Only owned, public-domain or licensed files. Browse freely. Download
            responsibly.
          </p>
        </footer>
      </body>
    </html>
  );
}
function Card({ m }: any) {
  return (
    <a className="card" href={`/${m.slug}.html`}>
      {m.poster ? (
        <img src={m.poster} alt={`${m.title} poster`} loading="lazy" />
      ) : (
        <div className="poster">◉</div>
      )}
      <div className="info">
        <span className="badge">{m.release_year}</span>
        <h3>{m.title}</h3>
        <p>{m.audio_languages || "Language not supplied"}</p>
        {m.qualities && <span className="badge">{m.qualities}</span>}
        <p>View details →</p>
      </div>
    </a>
  );
}
app.get("/robots.txt", (c) =>
  c.text(
    `User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml`,
  ),
);
app.get("/sitemap.xml", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT slug,updated_at FROM movies WHERE status='published' LIMIT 10000",
  ).all();
  c.header("Content-Type", "application/xml");
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.results.map((m) => `<url><loc>${escapeXML(new URL(c.req.url).origin + "/" + m.slug + ".html")}</loc><lastmod>${escapeXML(m.updated_at)}</lastmod></url>`).join("")}</urlset>`,
  );
});
// Asset binding responses can have immutable headers. Clone before security middleware.
async function serveAsset(c: any, path?: string) {
  const request = path ? new Request(new URL(path, c.req.url)) : c.req.raw;
  const response = await c.env.ASSETS.fetch(request);
  return new Response(response.body, response);
}
app.get("/admin", (c) => serveAsset(c, "/index.html"));
app.get("/assets/*", (c) => serveAsset(c));
app.get("*", async (c) => {
  const path = c.req.path;
  const base = new URL(c.req.url).origin;
  let title = "Discover your next download",
    description =
      "Explore an authorized movie library. Clear file details. No registration.",
    content: any;
  let structured: any;
  if (path === "/report-received") {
    title = "Report received";
    description = "Your report was submitted.";
    content = (
      <>
        <h1>Report received</h1>
        <p>The operator can now review your report.</p>
      </>
    );
  } else if (path === "/legal") {
    title = "Rights & help";
    content = (
      <>
        <h1>Rights, privacy & copyright</h1>
        <p>
          We distribute only content with verified authorization. Download
          availability depends on that authorization. Demo listings have no
          files.
        </p>
        <h2>Copyright reports</h2>
        <p>
          Submit your contact email, movie identifier, ownership evidence and
          requested action using POST /api/v1/reports. Reports are reviewed by
          the operator.
        </p>
        <form method="post" action="/report">
          <label>
            Contact email
            <input type="email" name="email" required />
          </label>
          <label>
            Movie URL, ownership evidence and requested action
            <textarea name="message" required minLength={20} maxLength={5000} />
          </label>
          <button>Submit copyright report</button>
        </form>
        <h2>Privacy</h2>
        <p>
          Admin cookies maintain sessions for eight hours. Download initiation
          counts are stored without visitor identifiers. IP addresses are hashed
          for short-term abuse controls. External file hosts apply their own
          policies.
        </p>
        <h2>Terms</h2>
        <p>
          Use downloads only as permitted by the stated license. No warranty of
          availability. Contact the operator through the report endpoint.
        </p>
      </>
    );
  } else if (path === "/categories") {
    title = "Browse categories";
    const cats = await c.env.DB.prepare(
      "SELECT * FROM categories ORDER BY name",
    ).all();
    content = (
      <>
        <h1>Browse categories</h1>
        <nav>
          {cats.results.map((x: any) => (
            <a key={x.id} className="button" href={`/category/${x.slug}`}>
              {x.name}
            </a>
          ))}
        </nav>
      </>
    );
  } else if (path.endsWith(".html")) {
    const m = await detail(
      c.env.DB,
      path.slice(1, -5),
      c.env.ALLOWED_DOWNLOAD_HOSTS,
    );
    if (!m) return c.notFound();
    title = m.seo_title || m.title;
    description = m.meta_description || m.synopsis;
    structured = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Movie",
          name: m.title,
          description: m.synopsis,
          url: base + path,
          ...(m.poster ? { image: m.poster } : {}),
          ...(m.release_date ? { datePublished: m.release_date } : {}),
        },
        {
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Home",
              item: base + "/",
            },
            {
              "@type": "ListItem",
              position: 2,
              name: m.title,
              item: base + path,
            },
          ],
        },
      ],
    };
    const related = await c.env.DB.prepare(
      "SELECT * FROM movies WHERE status='published' AND id<>? LIMIT 4",
    )
      .bind(m.id)
      .all();
    content = (
      <>
        <a href="/">Home / Movies / {m.title}</a>
        <h1>{m.title}</h1>
        <div className="detail">
          <div>
            {m.poster ? (
              <img
                style={{ width: "100%" }}
                src={m.poster}
                alt={`${m.title} poster`}
              />
            ) : (
              <div className="poster">◉</div>
            )}
          </div>
          <div>
            <h2>Movie information</h2>
            <dl>
              {Object.entries({
                Year: m.release_year,
                "Release date": m.release_date,
                Cast: m.cast_names,
                Director: m.director,
                Runtime: m.runtime ? `${m.runtime} minutes` : "Not supplied",
                Genres: m.genres.join(", "),
                Languages: m.languages.join(", "),
                Categories: m.categories.join(", "),
                Authorization: m.rights_status || "Not verified",
                License: m.license || "Not supplied",
              }).map(([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{String(v || "Not supplied")}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        </div>
        <section>
          <h2>About the movie</h2>
          <p>{m.synopsis}</p>
        </section>
        <section>
          <h2>Available downloads</h2>
          {m.files.length ? (
            m.files.map((f: any) => (
              <div key={f.id} className="card info">
                <h3>
                  {f.resolution} · {f.codec}
                </h3>
                <p>
                  {(f.bytes / 1048576).toFixed(1)} MiB · {f.audio} · {f.format}{" "}
                  · Subtitles: {f.subtitles || "None supplied"}
                </p>
                {f.enabled &&
                f.mirrors.some((mirror: any) => mirror.available) ? (
                  <a className="button" href={`/api/v1/downloads/${f.id}`}>
                    Download {f.resolution}
                  </a>
                ) : (
                  <span>Unavailable</span>
                )}
                <nav>
                  {f.mirrors.map((mirror: any) =>
                    mirror.available ? (
                      <a
                        key={mirror.id}
                        className="button"
                        href={`/api/v1/downloads/${f.id}?mirror=${encodeURIComponent(mirror.id)}`}
                      >
                        {mirror.label}
                      </a>
                    ) : (
                      <span key={mirror.id}>{mirror.label} · Unavailable</span>
                    ),
                  )}
                </nav>
                {f.checksum && <p>SHA-256: {f.checksum}</p>}
              </div>
            ))
          ) : (
            <p>No authorized files are currently available.</p>
          )}
        </section>
        <section>
          <h2>Screenshots</h2>
          {m.screenshots.length ? (
            m.screenshots.map((s: any) => (
              <img
                key={s.url}
                style={{ maxWidth: "100%" }}
                src={s.url}
                alt={s.alt}
                loading="lazy"
              />
            ))
          ) : (
            <p>No screenshots supplied.</p>
          )}
        </section>
        <section>
          <h2>More to discover</h2>
          <div className="grid">
            {related.results.map((m) => (
              <Card key={String(m.id)} m={m} />
            ))}
          </div>
        </section>
      </>
    );
  } else if (path === "/" || path.startsWith("/category/")) {
    const categorySlug = path.startsWith("/category/")
      ? path.slice(10)
      : undefined;
    if (categorySlug) {
      const category: any = await c.env.DB.prepare(
        "SELECT name FROM categories WHERE slug=?",
      )
        .bind(categorySlug)
        .first();
      if (!category) return c.notFound();
      title = category.name + " movies";
      description = "Browse authorized " + category.name + " movie listings.";
    }
    const result = await catalog(
      c,
      c.req.query("sort") || "latest",
      categorySlug,
    );
    content = (
      <>
        <span className="eyebrow">THE AUTHORIZED MOVIE LIBRARY</span>
        <h1>
          Great stories.
          <br />
          Yours to discover.
        </h1>
        <p>
          Explore movies with transparent rights and clear download choices.
        </p>
        <form className="filters" method="get">
          <input
            name="q"
            aria-label="Search movies"
            placeholder="Search a movie…"
            defaultValue={c.req.query("q")}
          />
          <input
            name="year"
            aria-label="Release year"
            type="number"
            placeholder="Year"
          />
          <input name="language" aria-label="Language" placeholder="Language" />
          <input
            name="category"
            aria-label="Category slug"
            placeholder="Category slug"
          />
          <select name="quality" aria-label="Resolution">
            <option value="">All qualities</option>
            {["480p", "720p", "1080p", "2160p"].map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
          <select name="sort" aria-label="Sort">
            <option value="latest">Latest</option>
            <option value="popular">Popular</option>
            <option value="updated">Recently updated</option>
          </select>
          <button>Find movies</button>
        </form>
        <h2>Explore the collection</h2>
        {result.data.length ? (
          <div className="grid">
            {result.data.map((m: any) => (
              <Card key={String(m.id)} m={m} />
            ))}
          </div>
        ) : (
          <p>No movies match these filters.</p>
        )}
        <section>
          <nav>
            {result.page > 1 && (
              <a
                href={`?${new URLSearchParams({ ...c.req.query(), page: String(result.page - 1) })}`}
              >
                ← Previous
              </a>
            )}
            {result.data.length === 24 && (
              <a
                href={`?${new URLSearchParams({ ...c.req.query(), page: String(result.page + 1) })}`}
              >
                Next →
              </a>
            )}
          </nav>
        </section>
      </>
    );
  } else return c.notFound();
  c.header("Cache-Control", "public, max-age=0, must-revalidate");
  const placements = (
    await c.env.DB.prepare(
      "SELECT id,label FROM ad_placements WHERE enabled=1",
    ).all()
  ).results;
  return c.html(
    "<!doctype html>" +
      renderToStaticMarkup(
        <Layout
          placements={placements}
          structured={structured}
          name={c.env.SITE_NAME}
          title={title}
          description={description}
          canonical={base + path}
        >
          {content}
        </Layout>,
      ),
  );
});
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at<?").bind(
        now(),
      ),
      env.DB.prepare("DELETE FROM auth_attempts WHERE window_start<?").bind(
        now() - 900,
      ),
    ]);
  },
};
export { movieSchema, fileSchema, mirrorSchema };
