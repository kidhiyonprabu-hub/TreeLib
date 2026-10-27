from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Mapping

from flask import Flask, jsonify, redirect, render_template, request, url_for

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
DB = Path(__file__).with_name("library.db")

DEMO_BOOKS: list[dict[str, Any]] = [
    {"id": 1, "title": "Clean Code", "author": "Robert C. Martin", "category": "Technology", "available": 1},
    {"id": 2, "title": "Python Crash Course", "author": "Eric Matthes", "category": "Technology", "available": 1},
    {"id": 3, "title": "The Alchemist", "author": "Paulo Coelho", "category": "Fiction", "available": 0},
    {"id": 4, "title": "Atomic Habits", "author": "James Clear", "category": "Self Help", "available": 1},
    {"id": 5, "title": "Data Structures", "author": "Seymour Lipschutz", "category": "Education", "available": 1},
]

CATALOG_CATEGORIES = [
    "Technology",
    "Fiction",
    "Education",
    "Self Help",
    "Science",
    "History",
    "Biography",
    "Finance",
    "Psychology",
    "Philosophy",
    "Travel",
    "Health & Wellness",
    "Art & Design",
    "Poetry",
    "Mystery",
    "Fantasy",
    "Environment",
    "Business",
    "Cooking",
    "Mathematics",
    "Astronomy",
    "Engineering",
    "Languages",
    "Sports",
]

CATALOG_AUTHORS = [
    "Mira Sen",
    "Arun Dev",
    "Leah Morgan",
    "K. R. Patel",
    "Nila Raman",
    "Sam Rivera",
    "A. J. Brooks",
    "Tara Iyer",
]


def sample_catalog() -> list[tuple[str, str, str]]:
    title_styles = (
        "A Field Guide to {category}",
        "{category} for Curious Minds",
        "Stories That Shape {category}",
        "An Illustrated Introduction to {category}",
        "Rethinking {category} Today",
    )
    return [
        (
            title_styles[edition].format(category=category),
            CATALOG_AUTHORS[(category_index + edition) % len(CATALOG_AUTHORS)],
            category,
        )
        for edition in range(len(title_styles))
        for category_index, category in enumerate(CATALOG_CATEGORIES)
    ]


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    con = sqlite3.connect(DB, timeout=5)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        with con:
            yield con
    finally:
        con.close()


def init_db() -> None:
    with connect() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                category TEXT NOT NULL,
                available INTEGER NOT NULL DEFAULT 1
                    CHECK (available IN (0, 1))
            )
            """
        )
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id INTEGER,
                book_title TEXT NOT NULL,
                action TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


class Node:
    def __init__(self, book: dict[str, Any]):
        self.book = book
        self.left: Node | None = None
        self.right: Node | None = None


def book_key(book: dict[str, Any]) -> tuple[str, int]:
    return str(book["title"]).casefold(), int(book["id"])


def insert(root: Node | None, book: dict[str, Any]) -> Node:
    if root is None:
        return Node(book)
    current = root
    while True:
        direction = "left" if book_key(book) < book_key(current.book) else "right"
        child = getattr(current, direction)
        if child is None:
            setattr(current, direction, Node(book))
            break
        current = child
    return root


def build_tree(books: list[dict[str, Any]]) -> Node | None:
    root = None
    for book in sorted(books, key=lambda item: int(item["id"])):
        root = insert(root, book)
    return root


def tree_data(root: Node | None) -> dict[str, Any] | None:
    if root is None:
        return None

    def node_data(node: Node) -> dict[str, Any]:
        return {
            "id": node.book["id"],
            "title": node.book["title"],
            "author": node.book["author"],
            "category": node.book.get("category", ""),
            "available": node.book.get("available", 1),
            "left": None,
            "right": None,
        }

    result = node_data(root)
    pending = [(root, result)]
    while pending:
        node, payload = pending.pop()
        if node.left is not None:
            payload["left"] = node_data(node.left)
            pending.append((node.left, payload["left"]))
        if node.right is not None:
            payload["right"] = node_data(node.right)
            pending.append((node.right, payload["right"]))
    return result


def search_book(root: Node | None, title: str) -> tuple[dict[str, Any] | None, list[str], int]:
    path: list[str] = []
    comparisons = 0
    target = title.casefold()
    found: dict[str, Any] | None = None
    while root is not None:
        comparisons += 1
        path.append(root.book["title"])
        current = str(root.book["title"]).casefold()
        if target == current:
            if found is None or int(root.book["id"]) < int(found["id"]):
                found = root.book
            root = root.left
        else:
            root = root.left if target < current else root.right
    return found, path, comparisons


def delete_book_node(
    root: Node | None, book_id: int
) -> tuple[Node | None, dict[str, Any] | None, int]:
    pending = [root] if root is not None else []
    target = None
    while pending:
        node = pending.pop()
        if int(node.book["id"]) == book_id:
            target = node.book
            break
        if node.left is not None:
            pending.append(node.left)
        if node.right is not None:
            pending.append(node.right)
    if target is None:
        return root, None, 0

    comparisons = 0
    parent = None
    current = root
    target_key = book_key(target)
    while current is not None:
        comparisons += 1
        current_key = book_key(current.book)
        if target_key == current_key:
            break
        parent = current
        current = current.left if target_key < current_key else current.right
    if current is None:
        return root, None, comparisons

    removed = current.book
    if current.left is not None and current.right is not None:
        successor_parent = current
        successor = current.right
        while successor.left is not None:
            comparisons += 1
            successor_parent = successor
            successor = successor.left
        current.book = successor.book
        if successor_parent is current:
            successor_parent.right = successor.right
        else:
            successor_parent.left = successor.right
    else:
        replacement = current.left if current.left is not None else current.right
        if parent is None:
            root = replacement
        elif parent.left is current:
            parent.left = replacement
        else:
            parent.right = replacement
    return root, removed, comparisons


def tree_metrics(root: Node | None) -> dict[str, int]:
    if root is None:
        return {"height": 0, "nodes": 0, "leaves": 0}
    nodes = leaves = height = 0
    pending = [(root, 1)]
    while pending:
        node, depth = pending.pop()
        nodes += 1
        height = max(height, depth)
        if node.left is None and node.right is None:
            leaves += 1
        if node.left is not None:
            pending.append((node.left, depth + 1))
        if node.right is not None:
            pending.append((node.right, depth + 1))
    return {"height": height, "nodes": nodes, "leaves": leaves}


def traversal(root: Node | None, order: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if order == "inorder":
        stack: list[Node] = []
        current = root
        while current is not None or stack:
            while current is not None:
                stack.append(current)
                current = current.left
            current = stack.pop()
            result.append(current.book)
            current = current.right
    elif order == "preorder":
        if root is not None:
            pending = [root]
            while pending:
                node = pending.pop()
                result.append(node.book)
                if node.right is not None:
                    pending.append(node.right)
                if node.left is not None:
                    pending.append(node.left)
    elif order == "postorder":
        if root is not None:
            pending = [(root, False)]
            while pending:
                node, visited = pending.pop()
                if visited:
                    result.append(node.book)
                    continue
                pending.append((node, True))
                if node.right is not None:
                    pending.append((node.right, False))
                if node.left is not None:
                    pending.append((node.left, False))
    return result


def get_books(demo: bool = False) -> list[dict[str, Any]]:
    if demo:
        return [dict(book) for book in DEMO_BOOKS]
    with connect() as con:
        rows = con.execute("SELECT id, title, author, category, available FROM books ORDER BY id").fetchall()
    return [dict(row) for row in rows]


def record_activity(con: sqlite3.Connection, book_id: int | None, title: str, action: str) -> None:
    con.execute(
        "INSERT INTO activities (book_id, book_title, action) VALUES (?, ?, ?)",
        (book_id, title, action),
    )


def fill_catalog_to_100() -> dict[str, int]:
    target_count = 100
    with connect() as con:
        con.execute("BEGIN IMMEDIATE")
        count = int(con.execute("SELECT COUNT(*) FROM books").fetchone()[0])
        existing_pairs = {
            (str(row["title"]).strip().casefold(), str(row["author"]).strip().casefold())
            for row in con.execute("SELECT title, author FROM books").fetchall()
        }
        added = 0
        if count < target_count:
            for title, author, category in sample_catalog():
                if count >= target_count:
                    break
                pair = (title.casefold(), author.casefold())
                if pair in existing_pairs:
                    continue
                cursor = con.execute(
                    "INSERT INTO books (title, author, category) VALUES (?, ?, ?)",
                    (title, author, category),
                )
                existing_pairs.add(pair)
                count += 1
                added += 1
            if added:
                record_activity(con, None, f"Sample catalogue: {added} books added", "Catalog expanded")
    return {"added": added, "total": count, "target": target_count}


def error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def request_data() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return {}
    return data


def validate_book(data: Mapping[str, Any]) -> tuple[dict[str, str] | None, str | None]:
    values = {}
    limits = {"title": 160, "author": 120, "category": 80}
    for field, limit in limits.items():
        value = data.get(field)
        if not isinstance(value, str) or not value.strip():
            return None, f"{field.title()} is required."
        value = value.strip()
        if len(value) > limit:
            return None, f"{field.title()} must be {limit} characters or fewer."
        values[field] = value
    return values, None


def duplicate_book(
    con: sqlite3.Connection,
    title: str,
    author: str,
    excluding_id: int | None = None,
) -> bool:
    rows = con.execute("SELECT id, title, author FROM books").fetchall()
    return any(
        (excluding_id is None or int(row["id"]) != excluding_id)
        and str(row["title"]).strip().casefold() == title.casefold()
        and str(row["author"]).strip().casefold() == author.casefold()
        for row in rows
    )


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/dashboard")
def dashboard():
    demo = request.args.get("demo") == "1"
    books = get_books(demo)
    categories: dict[str, int] = {}
    for book in books:
        categories[book["category"]] = categories.get(book["category"], 0) + 1
    if demo:
        activities = [
            {"book_title": "The Alchemist", "action": "Issued", "created_at": "Demo activity"},
            {"book_title": "Clean Code", "action": "Added", "created_at": "Demo activity"},
        ]
    else:
        with connect() as con:
            activities = [
                dict(row)
                for row in con.execute(
                    "SELECT book_title, action, created_at FROM activities ORDER BY id DESC LIMIT 6"
                ).fetchall()
            ]
    return jsonify(
        {
            "total": len(books),
            "available": sum(int(book["available"]) for book in books),
            "issued": sum(not int(book["available"]) for book in books),
            "categories": categories,
            "activities": activities,
            "catalog_target": 100,
            "catalog_category_count": len(CATALOG_CATEGORIES),
            "growth_available": len(books) < 100 and not demo,
        }
    )


@app.post("/api/catalog/seed-100")
def seed_catalog():
    result = fill_catalog_to_100()
    if result["added"] == 0:
        message = f"Your library already has {result['total']} books."
    else:
        message = f"Added {result['added']} sample books. Your library now has {result['total']} books."
    return jsonify({"message": message, **result})


@app.get("/api/discover")
def discover_books():
    demo = request.args.get("demo") == "1"
    try:
        offset = max(0, int(request.args.get("offset", "0")))
    except ValueError:
        return error("Discovery offset must be an integer.")
    books = get_books(demo)
    category_counts: dict[str, int] = {}
    for book in books:
        category = str(book["category"])
        category_counts[category] = category_counts.get(category, 0) + 1
    available = [book for book in books if int(book["available"]) == 1]
    available_categories = sorted(
        {str(book["category"]) for book in available},
        key=lambda category: (category_counts[category], category.casefold()),
    )
    picks: list[dict[str, Any]] = []
    if available_categories:
        start = offset % len(available_categories)
        rotated_categories = available_categories[start:] + available_categories[:start]
        for category in rotated_categories[:3]:
            book = min(
                (book for book in available if str(book["category"]) == category),
                key=lambda item: int(item["id"]),
            )
            picks.append(
                {
                    **book,
                    "shelf_size": category_counts[category],
                    "reason": f"Explore {book['category']} — one of your smaller shelves.",
                }
            )
    return jsonify({"books": picks, "available_count": len(available), "offset": offset})


@app.get("/api/books")
def list_books():
    demo = request.args.get("demo") == "1"
    search = request.args.get("search", "").strip().casefold()
    category = request.args.get("category", "").strip()
    availability = request.args.get("availability", "all")
    sort_by = request.args.get("sort", "title")
    direction = request.args.get("direction", "asc")
    page = request.args.get("page", "1")
    per_page = request.args.get("per_page", "50")
    if availability not in ("all", "available", "issued"):
        return error("Availability filter is invalid.")
    if sort_by not in ("title", "author", "id"):
        return error("Sort field is invalid.")
    if direction not in ("asc", "desc"):
        return error("Sort direction is invalid.")
    try:
        page_number = max(1, int(page))
        page_size = min(100, max(1, int(per_page)))
    except ValueError:
        return error("Page values must be integers.")

    books = get_books(demo)
    if search:
        books = [
            book
            for book in books
            if search in str(book["title"]).casefold()
            or search in str(book["author"]).casefold()
            or search in str(book["id"])
        ]
    if category:
        books = [book for book in books if book["category"] == category]
    if availability != "all":
        wanted = int(availability == "available")
        books = [book for book in books if int(book["available"]) == wanted]
    if sort_by == "id":
        books.sort(key=lambda book: int(book["id"]), reverse=direction == "desc")
    else:
        books.sort(
            key=lambda book: (str(book[sort_by]).casefold(), int(book["id"])),
            reverse=direction == "desc",
        )
    total = len(books)
    start = (page_number - 1) * page_size
    return jsonify(
        {
            "books": books[start : start + page_size],
            "total": total,
            "page": page_number,
            "pages": max(1, (total + page_size - 1) // page_size),
        }
    )


@app.post("/api/books")
def add_book():
    data, validation_error = validate_book(request_data())
    if validation_error:
        return error(validation_error)
    if data is None:
        return error("Book details are invalid.")
    with connect() as con:
        con.execute("BEGIN IMMEDIATE")
        if duplicate_book(con, data["title"], data["author"]):
            return error("A book with this title and author already exists.", 409)
        cursor = con.execute(
            "INSERT INTO books (title, author, category) VALUES (?, ?, ?)",
            (data["title"], data["author"], data["category"]),
        )
        book_id = cursor.lastrowid
        record_activity(con, book_id, data["title"], "Added")
        row = con.execute(
            "SELECT id, title, author, category, available FROM books WHERE id = ?", (book_id,)
        ).fetchone()
    return jsonify({"book": dict(row), "message": "Book added."}), 201


@app.route("/api/books/<int:book_id>", methods=["PUT", "DELETE"])
def manage_book(book_id: int):
    if request.method == "DELETE":
        with connect() as con:
            row = con.execute("SELECT title FROM books WHERE id = ?", (book_id,)).fetchone()
            if row is None:
                return error("Book not found.", 404)
            con.execute("DELETE FROM books WHERE id = ?", (book_id,))
            record_activity(con, book_id, row["title"], "Deleted")
        return jsonify({"message": "Book deleted."})

    data, validation_error = validate_book(request_data())
    if validation_error:
        return error(validation_error)
    if data is None:
        return error("Book details are invalid.")
    with connect() as con:
        con.execute("BEGIN IMMEDIATE")
        current = con.execute("SELECT id, title FROM books WHERE id = ?", (book_id,)).fetchone()
        if current is None:
            return error("Book not found.", 404)
        if duplicate_book(con, data["title"], data["author"], excluding_id=book_id):
            return error("A book with this title and author already exists.", 409)
        con.execute(
            "UPDATE books SET title = ?, author = ?, category = ? WHERE id = ?",
            (data["title"], data["author"], data["category"], book_id),
        )
        record_activity(con, book_id, data["title"], "Updated")
        row = con.execute(
            "SELECT id, title, author, category, available FROM books WHERE id = ?", (book_id,)
        ).fetchone()
    return jsonify({"book": dict(row), "message": "Book updated."})


@app.post("/api/books/<int:book_id>/<action>")
def change_availability(book_id: int, action: str):
    if action not in ("issue", "return"):
        return error("Action must be issue or return.")
    desired = 0 if action == "issue" else 1
    label = "Issued" if action == "issue" else "Returned"
    with connect() as con:
        con.execute("BEGIN IMMEDIATE")
        cursor = con.execute(
            "UPDATE books SET available = ? WHERE id = ? AND available = ?",
            (desired, book_id, 1 - desired),
        )
        if cursor.rowcount == 0:
            exists = con.execute("SELECT 1 FROM books WHERE id = ?", (book_id,)).fetchone()
            if exists is None:
                return error("Book not found.", 404)
            return error(f"Book is already {'issued' if action == 'issue' else 'available'}.", 409)
        row = con.execute("SELECT title FROM books WHERE id = ?", (book_id,)).fetchone()
        record_activity(con, book_id, row["title"], label)
    return jsonify({"message": f"Book {label.lower()}.", "available": desired})


@app.get("/api/bst")
def bst_snapshot():
    demo = request.args.get("demo") == "1"
    root = build_tree(get_books(demo))
    return jsonify({"tree": tree_data(root), **tree_metrics(root), "source": "demo" if demo else "database"})


@app.get("/api/search")
def search():
    title = request.args.get("title", "").strip()
    if not title:
        return error("Enter a book title.")
    demo = request.args.get("demo") == "1"
    books = get_books(demo)
    root = build_tree(books)
    start = time.perf_counter_ns()
    found, path, comparisons = search_book(root, title)
    bst_time = time.perf_counter_ns() - start

    start = time.perf_counter_ns()
    linear_found = None
    linear_comparisons = 0
    for book in books:
        linear_comparisons += 1
        if str(book["title"]).casefold() == title.casefold():
            linear_found = book
            break
    linear_time = time.perf_counter_ns() - start
    return jsonify(
        {
            "found": found,
            "message": "Book found." if found else "Book not found.",
            "path": path,
            "comparisons": comparisons,
            "linear": {
                "found": linear_found,
                "comparisons": linear_comparisons,
                "time_ns": linear_time,
                "complexity": "O(n) worst case",
            },
            "bst": {
                "found": found,
                "comparisons": comparisons,
                "time_ns": bst_time,
                "complexity": f"O(h), h = {tree_metrics(root)['height']}",
            },
            "tree_height": tree_metrics(root)["height"],
        }
    )


@app.get("/api/traversal/<order>")
def traversal_api(order: str):
    if order not in ("inorder", "preorder", "postorder"):
        return error("Traversal must be inorder, preorder, or postorder.")
    root = build_tree(get_books(request.args.get("demo") == "1"))
    return jsonify(
        {
            "order": order,
            "books": traversal(root, order),
            "explanation": {
                "inorder": "Visit left subtree, current node, then right subtree.",
                "preorder": "Visit current node, then left subtree, then right subtree.",
                "postorder": "Visit left subtree, then right subtree, then current node.",
            }[order],
        }
    )


# The earlier form-based routes remain available for existing bookmarks.
@app.post("/add")
def legacy_add():
    data, validation_error = validate_book(request.form)
    if validation_error:
        return error(validation_error)
    if data is None:
        return error("Book details are invalid.")
    with connect() as con:
        if duplicate_book(con, data["title"], data["author"]):
            return error("A book with this title and author already exists.", 409)
        cursor = con.execute(
            "INSERT INTO books (title, author, category) VALUES (?, ?, ?)",
            (data["title"], data["author"], data["category"]),
        )
        record_activity(con, cursor.lastrowid, data["title"], "Added")
    return redirect(url_for("index"))


@app.post("/delete/<int:book_id>")
def legacy_delete(book_id: int):
    with connect() as con:
        row = con.execute("SELECT title FROM books WHERE id = ?", (book_id,)).fetchone()
        if row:
            con.execute("DELETE FROM books WHERE id = ?", (book_id,))
            record_activity(con, book_id, row["title"], "Deleted")
    return redirect(url_for("index"))


@app.post("/toggle/<int:book_id>")
def legacy_toggle(book_id: int):
    with connect() as con:
        row = con.execute("SELECT title, available FROM books WHERE id = ?", (book_id,)).fetchone()
        if row:
            con.execute("UPDATE books SET available = ? WHERE id = ?", (1 - row["available"], book_id))
            record_activity(con, book_id, row["title"], "Issued" if row["available"] else "Returned")
    return redirect(url_for("index"))


@app.get("/search")
def legacy_search():
    title = request.args.get("title", "").strip()
    root = build_tree(get_books())
    found, path, comparisons = search_book(root, title)
    return jsonify(
        {
            "found": found,
            "path": path,
            "comparisons": comparisons,
            "message": "Book found!" if found else "Book not found.",
        }
    )


@app.get("/traversal/<order>")
def legacy_traversal(order: str):
    if order not in ("inorder", "preorder", "postorder"):
        return error("Invalid traversal.")
    result = traversal(build_tree(get_books()), order)
    return jsonify({"order": order, "books": [book["title"] for book in result]})


@app.errorhandler(sqlite3.Error)
def handle_database_error(exc: sqlite3.Error):
    app.logger.exception("SQLite operation failed")
    if request.path.startswith("/api/"):
        return error("The database operation could not be completed.", 500)
    return "The database operation could not be completed.", 500


init_db()

if __name__ == "__main__":
    app.run(debug=False)
