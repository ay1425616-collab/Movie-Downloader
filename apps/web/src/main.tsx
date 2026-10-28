import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
async function api(path: string, method = "GET", body?: unknown): Promise<any> {
  const response = await fetch("/api/v1/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
const initial = {
  title: "",
  slug: "",
  synopsis: "",
  poster: "",
  release_year: 2026,
  release_date: "",
  cast_names: "",
  director: "",
  runtime: null as number | null,
  seo_title: "",
  meta_description: "",
  status: "draft",
};
function App() {
  const [user, setUser] = useState<any>(null),
    [error, setError] = useState(""),
    [movies, setMovies] = useState<any[]>([]),
    [movie, setMovie] = useState<any>(initial),
    [selected, setSelected] = useState(""),
    [fileEdit, setFileEdit] = useState<any>(null),
    [mirrorEdit, setMirrorEdit] = useState<any>(null),
    [files, setFiles] = useState<any[]>([]),
    [mirrors, setMirrors] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [stats, setStats] = useState<any>({}),
    [reports, setReports] = useState<any[]>([]),
    [ads, setAds] = useState<any[]>([]),
    [categories, setCategories] = useState<any[]>([]);
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const refresh = async () => {
    setStats((await api("admin/dashboard")).data);
    setReports((await api("admin/reports")).data);
    setAds((await api("admin/ads")).data);
    setCategories((await api("categories")).data);
    setMovies((await api("admin/movies")).data);
    setFiles((await api("admin/files")).data);
    setMirrors((await api("admin/mirrors")).data);
  };
  useEffect(() => {
    api("admin/me")
      .then(async (r) => {
        setUser(r.data);
        await refresh();
      })
      .catch(() => {});
  }, []);
  const submit = (
    event: React.FormEvent<HTMLFormElement>,
    fn: (data: FormData) => Promise<void>,
  ) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => fn(data));
  };
  return (
    <main>
      <a href="/">← Public website</a>
      <h1 className="text-4xl font-bold my-6">CineWave Studio</h1>
      <p role="alert">{error}</p>
      <p role="status">{message}</p>
      {!user ? (
        <form
          onSubmit={(e) =>
            submit(e, async (d) => {
              await api("admin/login", "POST", Object.fromEntries(d));
              setUser((await api("admin/me")).data);
              await refresh();
            })
          }
        >
          <h2>Admin login</h2>
          <label>
            Email
            <input type="email" name="email" required autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              required
              minLength={14}
              autoComplete="current-password"
            />
          </label>
          <button>Sign in</button>
          <p>
            First admin must be created with the secure bootstrap procedure in
            README.
          </p>
        </form>
      ) : (
        <>
          <p>
            Signed in as {user.email} · {user.role}
          </p>
          <button
            onClick={() =>
              void run(async () => {
                await api("admin/logout", "POST", {});
                setUser(null);
              })
            }
          >
            Sign out
          </button>
          <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {Object.entries(stats).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-800 p-4">
                <strong className="text-3xl">{String(v)}</strong>
                <p>{k.replaceAll("_", " ")}</p>
              </div>
            ))}
          </section>
          <div className="grid gap-6 md:grid-cols-2">
            <section>
              <h2 className="text-2xl">Movies</h2>
              <p>
                {movies.length} loaded ·{" "}
                {movies.filter((m) => m.status === "published").length}{" "}
                published
              </p>
              <button
                onClick={() => {
                  setSelected("");
                  setMovie(initial);
                }}
              >
                New movie
              </button>
              {movies.map((m) => (
                <article key={m.id}>
                  <button
                    onClick={() => {
                      setSelected(m.id);
                      setMovie(
                        Object.fromEntries(
                          Object.keys(initial).map((k) => [k, m[k]]),
                        ),
                      );
                    }}
                  >
                    {m.title} · {m.status}
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api("admin/movies/" + m.id, "DELETE");
                        if (selected === m.id) {
                          setSelected("");
                          setMovie(initial);
                        }
                        await refresh();
                      })
                    }
                  >
                    Delete
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api(`admin/movies/${m.id}/duplicate`, "POST", {});
                        await refresh();
                      })
                    }
                  >
                    Duplicate as draft
                  </button>
                </article>
              ))}
            </section>
            <section>
              <h2 className="text-2xl">
                {selected ? "Edit movie" : "Create movie"}
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const result = await api(
                      "admin/movies" + (selected ? "/" + selected : ""),
                      selected ? "PUT" : "POST",
                      movie,
                    );
                    setSelected(result.id);
                    await refresh();
                    setMessage("Movie saved");
                  });
                }}
              >
                {Object.entries(movie).map(([key, value]) => (
                  <label key={key}>
                    {key.replaceAll("_", " ")}
                    {key === "status" ? (
                      <select
                        value={String(value)}
                        onChange={(e) =>
                          setMovie({ ...movie, status: e.target.value })
                        }
                      >
                        <option>draft</option>
                        <option>published</option>
                      </select>
                    ) : key === "synopsis" ? (
                      <textarea
                        value={String(value)}
                        onChange={(e) =>
                          setMovie({ ...movie, [key]: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        required={["title", "slug", "release_year"].includes(
                          key,
                        )}
                        type={
                          ["runtime", "release_year"].includes(key)
                            ? "number"
                            : "text"
                        }
                        value={value === null ? "" : String(value)}
                        onChange={(e) =>
                          setMovie({
                            ...movie,
                            [key]: ["runtime", "release_year"].includes(key)
                              ? e.target.value
                                ? Number(e.target.value)
                                : null
                              : e.target.value,
                            ...(key === "title" && !selected
                              ? {
                                  slug: e.target.value
                                    .toLowerCase()
                                    .replace(/[^a-z0-9]+/g, "-")
                                    .replace(/^-|-$/g, ""),
                                }
                              : {}),
                          })
                        }
                      />
                    )}
                  </label>
                ))}
                <button>Save movie</button>
              </form>
            </section>
          </div>
          <fieldset>
            <legend>Advertising placements (disabled by default)</legend>
            {ads.map((ad) => (
              <div key={ad.id}>
                {ad.label} · {ad.enabled ? "Enabled" : "Disabled"}
                <button
                  onClick={() =>
                    void run(async () => {
                      await api("admin/ads/" + ad.id, "PUT", {
                        enabled: ad.enabled ? 0 : 1,
                      });
                      await refresh();
                    })
                  }
                >
                  Toggle placement
                </button>
              </div>
            ))}
            <p>
              Placeholder visibility only. Advertising network scripts are not
              supported.
            </p>
          </fieldset>
          <fieldset>
            <legend>Copyright reports</legend>
            {reports.length ? (
              reports.map((r) => (
                <article key={r.id}>
                  <h3>
                    {r.status} · {r.email}
                  </h3>
                  <p>{r.message}</p>
                </article>
              ))
            ) : (
              <p>No reports</p>
            )}
          </fieldset>
          {selected && (
            <>
              <fieldset>
                <legend>Categories, genres & languages</legend>
                <form
                  onSubmit={(e) =>
                    submit(e, async (d) => {
                      await api(`admin/movies/${selected}/taxonomy`, "PUT", {
                        categories: d.getAll("categories"),
                        genres: String(d.get("genres"))
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        languages: String(d.get("languages"))
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                      setMessage("Taxonomy saved");
                    })
                  }
                >
                  {categories.map((cat) => (
                    <label key={cat.id}>
                      <input
                        style={{ display: "inline", width: "auto" }}
                        type="checkbox"
                        name="categories"
                        value={cat.id}
                      />
                      {cat.name}
                    </label>
                  ))}
                  <label>
                    Genres (comma-separated)
                    <input name="genres" />
                  </label>
                  <label>
                    Languages (comma-separated)
                    <input name="languages" />
                  </label>
                  <button>Replace taxonomy</button>
                </form>
              </fieldset>
              <fieldset>
                <legend>Screenshots</legend>
                <form
                  onSubmit={(e) =>
                    submit(e, async (d) => {
                      const screenshots = String(d.get("screenshots"))
                        .split("\n")
                        .filter(Boolean)
                        .map((line) => {
                          const [url, ...alt] = line.split("|");
                          return { url: url.trim(), alt: alt.join("|").trim() };
                        });
                      await api(`admin/movies/${selected}/screenshots`, "PUT", {
                        screenshots,
                      });
                      setMessage("Screenshots saved");
                    })
                  }
                >
                  <label>
                    One HTTPS URL | description per line
                    <textarea name="screenshots" />
                  </label>
                  <button>Replace screenshots</button>
                </form>
              </fieldset>
              <fieldset>
                <legend>Distribution authorization · Owner only</legend>
                <form
                  onSubmit={(e) =>
                    submit(e, async (d) => {
                      await api(
                        `admin/movies/${selected}/rights`,
                        "PUT",
                        Object.fromEntries(d),
                      );
                      setMessage("Rights record saved");
                    })
                  }
                >
                  <label>
                    License
                    <textarea name="license" required />
                  </label>
                  <label>
                    Evidence URL
                    <input name="evidence_url" type="url" required />
                  </label>
                  <label>
                    Verification
                    <select name="status">
                      <option>pending</option>
                      <option>verified</option>
                      <option>revoked</option>
                    </select>
                  </label>
                  <button>Save rights record</button>
                </form>
              </fieldset>
              <fieldset>
                <legend>Quality manager</legend>
                <button onClick={() => setFileEdit(null)}>New quality</button>
                <form
                  key={selected + "-" + (fileEdit?.id || "new")}
                  onSubmit={(e) =>
                    submit(e, async (d) => {
                      const values: any = Object.fromEntries(d);
                      values.movie_id = selected;
                      values.bytes = Number(values.bytes);
                      values.enabled = Number(values.enabled);
                      values.sort_order = Number(values.sort_order);
                      await api(
                        "admin/files" + (fileEdit ? "/" + fileEdit.id : ""),
                        fileEdit ? "PUT" : "POST",
                        values,
                      );
                      setFileEdit(null);
                      await refresh();
                      setMessage("File variant saved");
                    })
                  }
                >
                  <label>
                    Resolution
                    <select
                      name="resolution"
                      defaultValue={fileEdit?.resolution}
                    >
                      {["480p", "720p", "1080p", "2160p"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  {["codec", "audio", "format", "subtitles", "checksum"].map(
                    (k) => (
                      <label key={k}>
                        {k}
                        <input
                          name={k}
                          defaultValue={fileEdit?.[k] || ""}
                          required={["codec", "audio", "format"].includes(k)}
                        />
                      </label>
                    ),
                  )}
                  <label>
                    Actual size in bytes
                    <input
                      name="bytes"
                      type="number"
                      min="1"
                      defaultValue={fileEdit?.bytes}
                      required
                    />
                    <label>
                      Sort order
                      <input
                        name="sort_order"
                        type="number"
                        defaultValue={fileEdit?.sort_order || 0}
                      />
                    </label>
                  </label>
                  <label>
                    Availability
                    <select
                      name="enabled"
                      defaultValue={fileEdit?.enabled || 0}
                    >
                      <option value="0">Disabled</option>
                      <option value="1">Enabled</option>
                    </select>
                  </label>
                  <button>{fileEdit ? "Update quality" : "Add quality"}</button>
                </form>
                {files
                  .filter((f) => f.movie_id === selected)
                  .map((f) => (
                    <div key={f.id}>
                      {f.resolution} · {f.codec} · {f.bytes} bytes · ID: {f.id}
                      <button onClick={() => setFileEdit(f)}>
                        Edit quality
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            await api(`admin/files/${f.id}`, "DELETE");
                            await refresh();
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
              </fieldset>
              <fieldset>
                <legend>Authorized mirrors</legend>
                <button onClick={() => setMirrorEdit(null)}>New mirror</button>
                <form
                  key={selected + "-" + (mirrorEdit?.id || "new")}
                  onSubmit={(e) =>
                    submit(e, async (d) => {
                      const values: any = Object.fromEntries(d);
                      values.enabled = Number(values.enabled);
                      values.expires_at = values.expires_at
                        ? Math.floor(
                            new Date(values.expires_at).getTime() / 1000,
                          )
                        : null;
                      await api(
                        "admin/mirrors" +
                          (mirrorEdit ? "/" + mirrorEdit.id : ""),
                        mirrorEdit ? "PUT" : "POST",
                        values,
                      );
                      setMirrorEdit(null);
                      await refresh();
                      setMessage("Mirror saved");
                    })
                  }
                >
                  <label>
                    File
                    <select
                      name="file_id"
                      defaultValue={mirrorEdit?.file_id}
                      required
                    >
                      {files
                        .filter((f) => f.movie_id === selected)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.resolution} · {f.codec}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Provider label
                    <input
                      name="label"
                      defaultValue={mirrorEdit?.label}
                      required
                    />
                  </label>
                  <label>
                    Approved HTTPS URL
                    <input
                      name="url"
                      type="url"
                      defaultValue={mirrorEdit?.url}
                      required
                    />
                  </label>
                  <label>
                    Availability
                    <select
                      name="enabled"
                      defaultValue={mirrorEdit?.enabled || 0}
                    >
                      <option value="0">Disabled</option>
                      <option value="1">Enabled</option>
                    </select>
                  </label>
                  <label>
                    Expires at (optional UTC)
                    <input
                      type="datetime-local"
                      name="expires_at"
                      defaultValue={
                        mirrorEdit?.expires_at
                          ? new Date(mirrorEdit.expires_at * 1000)
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                    />
                  </label>
                  <button>{mirrorEdit ? "Update mirror" : "Add mirror"}</button>
                </form>
                {mirrors
                  .filter((m) =>
                    files.some(
                      (f) => f.id === m.file_id && f.movie_id === selected,
                    ),
                  )
                  .map((m) => (
                    <div key={m.id}>
                      {m.label} · {m.enabled ? "Enabled" : "Disabled"}
                      <button onClick={() => setMirrorEdit(m)}>
                        Edit mirror
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            await api(`admin/mirrors/${m.id}`, "DELETE");
                            await refresh();
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
              </fieldset>
            </>
          )}
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
