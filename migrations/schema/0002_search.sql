CREATE VIRTUAL TABLE movies_search USING fts5(title,content='movies',content_rowid='rowid',prefix='2 3 4');
CREATE TRIGGER movies_search_insert AFTER INSERT ON movies BEGIN INSERT INTO movies_search(rowid,title) VALUES(new.rowid,new.title); END;
CREATE TRIGGER movies_search_delete AFTER DELETE ON movies BEGIN INSERT INTO movies_search(movies_search,rowid,title) VALUES('delete',old.rowid,old.title); END;
CREATE TRIGGER movies_search_update AFTER UPDATE OF title ON movies BEGIN INSERT INTO movies_search(movies_search,rowid,title) VALUES('delete',old.rowid,old.title); INSERT INTO movies_search(rowid,title) VALUES(new.rowid,new.title); END;
INSERT INTO movies_search(movies_search) VALUES('rebuild');
