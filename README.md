# TreeLib — Smart Library Management System

TreeLib is a beginner-friendly library dashboard that combines real SQLite book management with a Binary Search Tree (BST) learning lab. Its BST is built by inserting books in database-ID order; it is not a sorted-list illustration or a self-balancing tree.

## Project abstract

Libraries need reliable ways to store and find books. TreeLib provides an interactive catalog for adding, editing, searching, issuing, returning, and deleting books, with live statistics and activity history. A Flask API stores records in SQLite and constructs a title-keyed BST so students can inspect insertion shape, search paths, traversals, tree metrics, and the difference between linear search and BST search.

## Problem statement

A basic book list can store records but does not demonstrate how data structures affect search and ordering. Students also need a safe, usable way to see how everyday library operations map to persistent data. TreeLib brings those requirements together in a small web application.

## Objectives

- Manage a book collection using a clear, validated web interface.
- Preserve the existing SQLite catalog while safely adding activity history.
- Demonstrate actual BST insertion, search, deletion, and depth-first traversals.
- Compare linear and BST searches using real comparison counts and actual tree height.
- Explain the data structure and course-outcome mapping with an isolated sample demo.

## Features

- Dashboard statistics, recent activity, category distribution, and availability charts.
- One-click expansion to 100 books across 24 categories, preserving the existing catalog and safely skipping duplicate title/author pairs.
- Smart Discovery recommendations that prioritize available books from the smallest category shelves.
- Book create, edit, delete, title/author/ID search, category/status filters, sorting, and pagination.
- Consistent issue/return operations that reject invalid repeated transitions.
- Duplicate title-and-author protection and server-side field validation.
- Responsive navigation and mobile-friendly book cards with visible Issue/Return, Edit, and Delete actions, plus light/dark theme, accessible labels, toast messages, and confirmations.
- BST visualizer with root/left/right structure, height, node/leaf counts, search-path highlights, and temporary insert/delete exercises.
- Scalable BST overview with fit/zoom controls, connected edges, keyboard-selectable nodes, and full node details.
- Inorder, preorder, and postorder results displayed immediately; optional step-by-step traversal highlights the current node and can be skipped.
- Linear-versus-BST search comparison including result, path, comparison count, approximate timing, and complexity.
- A separate BFS/DFS graph exercise; graph traversal is not mislabeled as BST traversal.
- Read-only sample demo mode that does not alter saved library records.

## Architecture

```text
Browser (HTML, CSS, JavaScript, Chart.js)
        │ JSON over HTTP
        ▼
Flask application (validation, API routes, BST algorithms)
        │ parameterized SQLite queries
        ▼
library.db (books + activity log)
```

`app.py` owns the Flask routes, SQLite access, data validation, activity logging, and BST implementation. `templates/index.html` defines the dashboard and learning views. `static/style.css` contains the responsive theme and components. `static/script.js` connects the interface to the JSON API and renders the interactive tree using safe DOM APIs.

On startup, TreeLib uses `CREATE TABLE IF NOT EXISTS` for its existing `books` schema and creates an `activities` table. It does not drop, recreate, or seed over existing book records. The activity table is additive; existing records are preserved.

The dashboard's **Expand to 100 books** action is explicit and repeat-safe: it adds illustrative sample entries until the catalog contains 100 books, without changing or removing existing records. Sample titles/authors are generated for the demonstration; they are not a verified bibliography. The catalogue spans 24 categories, and the Smart Discovery shelf ranks available books from less-represented categories. Its suggestions use category counts and availability, not personal reading history.

## Technology stack

- Python 3.13
- Flask 3.x
- SQLite (Python standard library)
- HTML5, CSS, JavaScript
- Chart.js 4 (loaded from a CDN for charts)

## BST algorithm explanation

Each persisted book is inserted into an ordinary, unbalanced BST in ascending database-ID order. The comparison key is `(casefolded title, book ID)`: titles determine alphabetical left/right placement, and ID gives distinct, deterministic positions to books with duplicate titles. Search compares titles and chooses a branch; if titles are duplicated, it returns the matching record with the lowest ID. Inorder traversal therefore emits titles in alphabetical order.

Deletion follows the usual BST cases:

1. A leaf is removed directly.
2. A node with one child is replaced by that child.
3. A node with two children is replaced by its inorder successor, then the successor is removed.

The database tree is rebuilt from the stored records in ID order when requested; this makes the displayed structure reproducible and means the tree is not a separately persisted index. The visualizer's “Insert sample node” and “Delete title” controls operate on a temporary in-browser copy and do not write to SQLite. “Rebuild from library” restores the saved database tree. Library CRUD changes the source records and the next rebuild reflects those changes.

For `n` books and height `h`, BST search is `O(h)`: approximately `O(log n)` in a balanced tree and `O(n)` in a skewed tree. A normal BST is not automatically balanced. Linear search is `O(n)` in the worst case. The displayed wall-clock timings are approximate and affected by system load; they measure lookup after the tree is constructed, not the cost of rebuilding it. Comparison counts and actual tree shape are better classroom metrics. Deletion is `O(h)` after locating the node; the teaching implementation uses an iterative unlink step.

## Course outcome mapping

| Course outcome | TreeLib demonstration |
|---|---|
| CO3 — Algorithm comparison | Search Lab compares linear search with BST search for the same title, showing results, counts, timing, and complexity without claiming that BST is always faster. |
| CO4 — Tree operations | BST Visualizer demonstrates insertion, search, deletion, root/child relationships, tree metrics, and inorder/preorder/postorder traversal. |
| CO5 — Graph traversal (if required) | Analytics provides a separate graph example with working breadth-first search (BFS) and depth-first search (DFS). These are graph operations, not BST traversals. |

## Installation and run commands

From the project directory on Windows with Python 3.13 installed:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000). To run from Command Prompt instead of PowerShell, activate with:

```bat
.venv\Scripts\activate.bat
```

The database file is `library.db` beside `app.py`. Back up this file before manually editing or moving the database.

## Automated tests

Run the backend/API and BST tests with:

```powershell
python -m unittest discover -s tests -v
```

The tests use temporary SQLite databases and cover create/edit/delete, duplicate handling, issue/return edge cases, validation, search comparison, filtering/sorting, demo isolation, BST shape, all three traversals, duplicate titles, deletion cases, empty-tree behavior, and preservation of records across initialization.

## Screenshots

Screenshots can be added here after running the application. Suggested captures:

1. Dashboard with collection and availability charts.
2. BST visualizer with search path and traversal output.
3. Search Lab comparison results.
4. Analytics with the CO3/CO4/CO5 mapping.

## Five-minute college presentation

1. **0:00–0:45 — Introduce TreeLib.** Start on the dashboard and explain that library data is stored in SQLite while the BST is built from real records.
2. **0:45–1:30 — Show library operations.** Add or edit a book, then issue and return it. Point out that totals, availability, category charts, and activity update.
3. **1:30–2:30 — Explain the tree.** Open BST Visualizer. The sample set is inserted in ID order. Search a title, insert a temporary node, then delete it; explain that these lab changes do not modify the database.
4. **2:30–3:30 — Show traversal.** Run inorder, preorder, and postorder, explaining their visit order. Inorder lists the BST's titles alphabetically.
5. **3:30–4:30 — Compare search.** Search for `Clean Code` in Search Lab. Compare actual comparisons and the tree height; timings are approximate and may vary.
6. **4:30–5:00 — Discuss outcomes and limits.** Summarize CO3 comparison, CO4 tree operations, and the separate CO5 graph BFS/DFS example. Mention that an ordinary BST can become skewed.

For a presentation when the real database is empty, choose **Try demo**. It loads five sample books without inserting them into SQLite: Clean Code, Python Crash Course, The Alchemist, Atomic Habits, and Data Structures. The sample has four available books, one issued book, and four categories. To populate the actual SQLite catalog for a larger live demonstration, choose **Expand to 100 books**; this preserves existing records and spreads the illustrative sample entries across 24 categories. Exit demo mode to return to the saved database.

## Limitations and future enhancements

- The BST is intentionally unbalanced to make insertion order and worst-case behavior visible.
- The temporary visualizer insert/delete operations are demonstrations, not persistent book operations; use the Books view for database changes.
- SQLite is suitable for a local college demonstration, not concurrent multi-user deployments.
- Chart.js and the typography are fetched from CDNs; dashboard charts and custom fonts need an internet connection. The library/API itself runs locally.
- Future improvements could add authentication, borrowing-member records, due dates, balanced-tree comparisons (AVL/red-black), database backup/export, and offline chart assets.
