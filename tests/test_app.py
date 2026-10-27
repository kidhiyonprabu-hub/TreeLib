import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as treelib


class TreeLibTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Path(self.temp_dir.name) / "test-library.db"
        self.db_patch = patch.object(treelib, "DB", self.database)
        self.db_patch.start()
        treelib.init_db()
        self.client = treelib.app.test_client()

    def tearDown(self):
        self.db_patch.stop()
        self.temp_dir.cleanup()

    def add_book(self, title, author="Test Author", category="Testing"):
        return self.client.post(
            "/api/books",
            json={"title": title, "author": author, "category": category},
        )

    def test_book_create_duplicate_edit_delete(self):
        created = self.add_book("Maple", "A. Writer")
        self.assertEqual(created.status_code, 201)
        book_id = created.get_json()["book"]["id"]
        duplicate = self.add_book(" maple ", "a. writer")
        self.assertEqual(duplicate.status_code, 409)

        updated = self.client.put(
            f"/api/books/{book_id}",
            json={"title": "Updated Maple", "author": "A. Writer", "category": "Reference"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["book"]["category"], "Reference")

        deleted = self.client.delete(f"/api/books/{book_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/books").get_json()["total"], 0)
        self.assertEqual(self.client.delete(f"/api/books/{book_id}").status_code, 404)

    def test_issue_return_and_input_validation(self):
        created = self.add_book("Borrow Me")
        book_id = created.get_json()["book"]["id"]
        self.assertEqual(self.client.post(f"/api/books/{book_id}/issue").status_code, 200)
        self.assertEqual(self.client.post(f"/api/books/{book_id}/issue").status_code, 409)
        self.assertEqual(self.client.post(f"/api/books/{book_id}/return").status_code, 200)
        self.assertEqual(self.client.post(f"/api/books/{book_id}/return").status_code, 409)
        self.assertEqual(self.client.post("/api/books/999/issue").status_code, 404)
        self.assertEqual(self.client.post("/api/books", json={"title": "Missing fields"}).status_code, 400)

    def test_search_filters_sorting_and_demo_mode(self):
        self.add_book("Zebra", "Z. Author", "Wildlife")
        self.add_book("Apple", "A. Author", "Fiction")
        self.add_book("Apple", "B. Author", "Fiction")

        result = self.client.get("/api/search?title=apple").get_json()
        self.assertEqual(result["found"]["title"], "Apple")
        self.assertEqual(result["found"]["id"], 2)
        self.assertGreater(result["linear"]["comparisons"], 0)
        self.assertGreater(result["bst"]["comparisons"], 0)
        self.assertIn("O(h)", result["bst"]["complexity"])

        filtered = self.client.get("/api/books?category=Fiction&sort=author").get_json()
        self.assertEqual([book["author"] for book in filtered["books"]], ["A. Author", "B. Author"])
        self.assertEqual(self.add_book("Straße", "Jörg").status_code, 201)
        unicode_duplicate = self.add_book("STRASSE", "JÖRG")
        self.assertEqual(unicode_duplicate.status_code, 409)
        available = self.client.get("/api/books?availability=available").get_json()
        self.assertEqual(available["total"], 4)
        self.assertEqual(self.client.get("/api/books?sort=unknown").status_code, 400)

        before = self.client.get("/api/dashboard").get_json()["total"]
        demo = self.client.get("/api/dashboard?demo=1").get_json()
        self.assertEqual(demo["total"], 5)
        self.assertEqual(self.client.get("/api/dashboard").get_json()["total"], before)

    def test_numeric_id_sorting(self):
        for index in range(12):
            self.add_book(f"Book {index}", author=f"Author {index}")
        ascending = self.client.get("/api/books?sort=id&per_page=20").get_json()
        descending = self.client.get("/api/books?sort=id&direction=desc&per_page=20").get_json()
        self.assertEqual([book["id"] for book in ascending["books"]], list(range(1, 13)))
        self.assertEqual([book["id"] for book in descending["books"]], list(range(12, 0, -1)))

    def test_seed_catalog_adds_one_hundred_books_across_categories(self):
        response = self.client.post("/api/catalog/seed-100")
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertEqual(result["total"], 100)
        self.assertEqual(result["added"], 100)

        dashboard = self.client.get("/api/dashboard").get_json()
        self.assertEqual(dashboard["total"], 100)
        self.assertEqual(len(dashboard["categories"]), 24)
        self.assertFalse(dashboard["growth_available"])

        books = self.client.get("/api/books?per_page=100").get_json()
        self.assertEqual(len(books["books"]), 100)
        self.assertEqual(
            self.client.post("/api/catalog/seed-100").get_json()["added"],
            0,
        )
        self.assertEqual(self.client.get("/api/dashboard").get_json()["total"], 100)

    def test_smart_discovery_recommends_available_books_from_small_shelves(self):
        self.add_book("Rare Shelf One", "Author One", "Robotics")
        self.add_book("Rare Shelf Two", "Author Two", "Robotics")
        self.add_book("Popular Shelf", "Author Three", "Fiction")
        self.add_book("Popular Shelf Two", "Author Four", "Fiction")
        self.add_book("Popular Shelf Three", "Author Five", "Fiction")
        self.add_book("Creative Shelf", "Author Six", "Art")
        self.add_book("Creative Shelf Two", "Author Seven", "Art")
        self.add_book("Creative Shelf Three", "Author Eight", "Art")
        discovery = self.client.get("/api/discover").get_json()
        self.assertEqual(len(discovery["books"]), 3)
        self.assertEqual(discovery["books"][0]["category"], "Robotics")
        self.assertEqual(discovery["books"][0]["shelf_size"], 2)
        self.assertEqual(len({book["category"] for book in discovery["books"]}), 3)
        next_discovery = self.client.get("/api/discover?offset=1").get_json()
        self.assertNotEqual(
            discovery["books"][0]["category"],
            next_discovery["books"][0]["category"],
        )

        self.client.post(f"/api/books/{discovery['books'][0]['id']}/issue")
        available = self.client.get("/api/discover").get_json()
        self.assertNotEqual(available["books"][0]["id"], discovery["books"][0]["id"])
        self.assertEqual(self.client.get("/api/discover?offset=bad").status_code, 400)

    def test_tree_shape_traversal_and_empty_edges(self):
        for title in ("Maple", "Ash", "Pine", "Birch"):
            self.add_book(title)
        snapshot = self.client.get("/api/bst").get_json()
        self.assertEqual(snapshot["tree"]["title"], "Maple")
        self.assertEqual(snapshot["tree"]["left"]["title"], "Ash")
        self.assertEqual(snapshot["tree"]["right"]["title"], "Pine")
        self.assertEqual(snapshot["tree"]["left"]["right"]["title"], "Birch")
        self.assertEqual((snapshot["height"], snapshot["nodes"], snapshot["leaves"]), (3, 4, 2))
        inorder = self.client.get("/api/traversal/inorder").get_json()["books"]
        self.assertEqual([book["title"] for book in inorder], ["Ash", "Birch", "Maple", "Pine"])
        preorder = self.client.get("/api/traversal/preorder").get_json()["books"]
        self.assertEqual([book["title"] for book in preorder], ["Maple", "Ash", "Birch", "Pine"])
        postorder = self.client.get("/api/traversal/postorder").get_json()["books"]
        self.assertEqual([book["title"] for book in postorder], ["Birch", "Ash", "Pine", "Maple"])
        self.assertEqual(self.client.get("/api/traversal/invalid").status_code, 400)

        empty = treelib.build_tree([])
        self.assertIsNone(empty)
        self.assertEqual(treelib.tree_metrics(empty), {"height": 0, "nodes": 0, "leaves": 0})
        self.assertEqual(treelib.search_book(empty, "Missing"), (None, [], 0))

    def test_bst_delete_leaf_one_child_two_children_and_duplicate_title(self):
        books = [
            {"id": 1, "title": "Maple", "author": "A"},
            {"id": 2, "title": "Ash", "author": "B"},
            {"id": 3, "title": "Pine", "author": "C"},
            {"id": 4, "title": "Birch", "author": "D"},
            {"id": 5, "title": "Maple", "author": "E"},
        ]
        root = treelib.build_tree(books)
        found, _, _ = treelib.search_book(root, "MAPLE")
        self.assertEqual(found["id"], 1)

        root, deleted, comparisons = treelib.delete_book_node(root, 4)
        self.assertEqual(deleted["title"], "Birch")
        self.assertGreater(comparisons, 0)
        self.assertEqual(treelib.tree_metrics(root)["nodes"], 4)

        root, deleted, _ = treelib.delete_book_node(root, 1)
        self.assertEqual(deleted["id"], 1)
        self.assertEqual(treelib.tree_metrics(root)["nodes"], 3)
        self.assertEqual(treelib.search_book(root, "Maple")[0]["id"], 5)

        root, deleted, _ = treelib.delete_book_node(root, 999)
        self.assertIsNone(deleted)
        self.assertEqual(treelib.tree_metrics(root)["nodes"], 3)

    def test_bst_delete_node_with_one_child_and_skewed_tree(self):
        root = treelib.build_tree(
            [
                {"id": 1, "title": "Maple", "author": "A"},
                {"id": 2, "title": "Ash", "author": "B"},
                {"id": 3, "title": "Birch", "author": "C"},
            ]
        )
        root, deleted, _ = treelib.delete_book_node(root, 2)
        self.assertEqual(deleted["title"], "Ash")
        self.assertEqual(root.left.book["title"], "Birch")

        skewed = treelib.build_tree(
            [{"id": index, "title": f"Title {index:04}", "author": "A"} for index in range(1, 1200)]
        )
        self.assertEqual(treelib.tree_metrics(skewed)["height"], 1199)
        self.assertEqual(len(treelib.traversal(skewed, "preorder")), 1199)
        self.assertEqual(treelib.tree_data(skewed)["title"], "Title 0001")

    def test_existing_database_records_are_not_reseeded_or_changed(self):
        con = sqlite3.connect(self.database)
        try:
            con.execute(
                "INSERT INTO books (title, author, category) VALUES (?, ?, ?)",
                ("A saved record", "Existing Author", "Archive"),
            )
            con.commit()
        finally:
            con.close()
        treelib.init_db()
        con = sqlite3.connect(self.database)
        try:
            rows = con.execute("SELECT title, author FROM books").fetchall()
        finally:
            con.close()
        self.assertEqual(rows, [("A saved record", "Existing Author")])


if __name__ == "__main__":
    unittest.main()
