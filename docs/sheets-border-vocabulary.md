# Sheets border vocabulary

Border normalization follows the pinned CLI's side, line-style and thickness vocabulary. Canonical side objects accept width/type aliases, thickness words, positive numeric widths, case normalization, and all/outer expansion with explicit side precedence. Scalar border flags describe all sides.

Typed cell and declarative style payloads also accept border/borders, flattened side attributes in either word order, width aliases, and border_type selectors. Explicit collisions are rejected deterministically. A single-side selector moves all-side attributes to that side while preserving more specific attributes. Full-grid and no-border selectors are supported; outline/interior selectors are rejected because a uniform per-cell border cannot express their requested geometry. Inputs are cloned before normalization.

Standalone border style flags and declarative style stamps use the same normalizer as typed cells. Scalar flags are parsed as their JSON or loose-JSON values, and declarative border families are folded before matrix generation so unknown aliases cannot silently disappear.
