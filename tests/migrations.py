import sqlite3, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class SchemaTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.db.executescript((ROOT/'migrations/schema/0001_initial.sql').read_text());[self.db.executescript(m.read_text()) for m in sorted((ROOT/'migrations/schema').glob('000[2-9]*.sql'))];self.db.executescript((ROOT/'migrations/seed.sql').read_text())
 def test_seed_is_repeatable(self):
  self.db.executescript((ROOT/'migrations/seed.sql').read_text());self.assertEqual(self.db.execute('SELECT count(*) FROM movies').fetchone()[0],1);self.assertEqual(self.db.execute('SELECT count(*) FROM movie_files').fetchone()[0],0)
 def test_indexed_title_search(self):
  self.assertEqual(self.db.execute("SELECT count(*) FROM movies_search WHERE movies_search MATCH ?", ('\"Light\"*',)).fetchone()[0],1)
 def test_unique_slug(self):
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO movies(id,title,slug,release_year) VALUES ('x','Duplicate','the-last-lighthouse-demo',2026)")
 def test_foreign_key(self):
  with self.assertRaises(sqlite3.IntegrityError):self.db.execute("INSERT INTO movie_categories(movie_id,category_id) VALUES ('missing','1')")
 def test_cascade(self):
  self.db.execute("DELETE FROM movies WHERE id='demo'");self.assertEqual(self.db.execute('SELECT count(*) FROM movie_categories').fetchone()[0],0)
 def test_authorization_query_denies_demo(self):
  self.assertEqual(self.db.execute("SELECT count(*) FROM movies m JOIN rights_records r ON r.movie_id=m.id WHERE r.status='verified'").fetchone()[0],0)
if __name__=='__main__':unittest.main()
