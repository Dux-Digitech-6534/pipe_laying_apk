# mobile_api.py — Pipe Laying mobile app API
#
# Screen-shaped, permission-checked whitelisted endpoints for the hosted SPA
# (/pipe-laying, /pipe-laying/m) and the Capacitor APK that loads it.
#
# Auto-exposed at /api/method/pipe_laying_inhouse.mobile_api.<fn>
#
# DESIGN NOTES
# ------------
# * Every write endpoint enforces permissions; lists use permission-scoped
#   frappe.get_list. capabilities() is UI convenience only.
# * All business math mirrors the LIVE desk client scripts exactly:
#     - "Pour Card Details Popup (jewipl)"  -> laying batch formulas
#     - "Pour Card Backfilling Button"      -> backfilling formulas
#     - "Pour Card Total Quantity"          -> total_quantity = sum(items.qauntity)
#     - pour_card.py validate()             -> duplicate junction-pair rule
# * Masters are served dynamically from the DB, so anything added/changed in
#   the backend shows up in the app on the next masters refresh (no rebuild).
# * Offline replay safety: every mutating endpoint is IDEMPOTENT.
#     - Pour Card creation dedupes on the doctype's own natural duplicate key
#       (the same 8 fields pour_card.py validates on), so a replayed create can
#       never produce a second card.
#     - Laying batches are ledgered as a Comment on the Pour Card
#       ("plm-batch:<uid>"); a replayed batch is detected and skipped.
#   Neither needs a schema change.

import json

import frappe
from frappe import _
from frappe.utils import cint, flt, get_fullname, nowdate

# ---------------------------------------------------------------- constants

PIPE_ITEM_GROUPS = ["DI", "HDPE", "MDPE"]

ACC_ITEM_GROUPS = [
    "Collar", "Clamp", "Tyton Ring", "Rabbar Gasket", "D i tee socket",
    "Sluice Valve", "M.S. Elanged", "Rabbar Packing", "Water Mtr.",
    "EF Reducer", "Strup Bend", "EF couplar", "EF Equal TEE",
    "EF End Cap", "EF Bend 45",
]

# Pour Card child-table fieldname -> child doctype (verified against live meta)
TABLES = {
    "pipe": "table_zxzx",        # Pipe Laying Detail Child
    "soft": "table_tvca",        # Soft Rock Detail Child
    "hard": "table_uefn",        # Hard Rock Details Child
    "murum": "table_md",         # Murum Details Child
    "cc": "table_owyi",          # CC Road Breaking Detail Child
    "soil": "pipe_remarks",      # Soil Detail Child
    "acc": "items",              # Pour Card Accessories And Quantity
    "backfill": "custom__backfilling_details",  # Backfilling Detail child
}

# The 8 fields pour_card.py's validate() uses for its duplicate check. Reused
# here as the natural idempotency key for offline replay.
DUP_KEY = [
    "company", "townproject", "zone_name", "village_name",
    "component", "select_contractor", "from_junction", "to_junction",
]

HEADER_FIELDS = [
    "townproject", "zone_name", "village_name", "component",
    "select_contractor", "from_junction", "to_junction",
]

BATCH_LEDGER_PREFIX = "plm-batch:"


# ---------------------------------------------------------------- helpers

def _default_company():
    return (
        frappe.defaults.get_user_default("Company")
        or frappe.db.get_single_value("Global Defaults", "default_company")
    )


def _parse(payload):
    if isinstance(payload, str):
        return frappe.parse_json(payload) or {}
    return payload or {}


def _require(perm, doctype="Pour Card"):
    if not frappe.has_permission(doctype, perm):
        frappe.throw(
            _("You do not have permission to {0} {1}.").format(perm, doctype),
            frappe.PermissionError,
        )


def calc_qty(length, width, depth):
    """L x W x D — 0 unless all three are non-zero (matches pcd_calc_qty)."""
    length, width, depth = flt(length), flt(width), flt(depth)
    if not length or not width or not depth:
        return 0.0
    return length * width * depth


def extract_diameter_mm(pipe_details):
    """Pull the mm diameter out of an item name like '200mm HDPE'.

    Mirrors pcd_extract_diameter_mm: prefer a number followed by 'mm', else the
    first number in the string, else 0.
    """
    import re

    if not pipe_details:
        return 0.0

    text = str(pipe_details)

    m = re.search(r"(\d+(\.\d+)?)\s*mm", text, re.IGNORECASE)
    if m:
        return flt(m.group(1))

    m = re.search(r"(\d+(\.\d+)?)", text)
    if m:
        return flt(m.group(1))

    return 0.0


def calc_pipe_volume(pipe_details, pipe_length):
    """(3.14 * d^2 / 4) * L, d in metres (matches pcd_calc_pipe_volume)."""
    d_m = extract_diameter_mm(pipe_details) / 1000.0
    return (3.14 * d_m * d_m / 4.0) * flt(pipe_length)


def derive_laying_totals(v):
    """The full derived-value set for one laying batch.

    Single source of truth for the calculations, shared by the client (which
    mirrors it for instant feedback offline) and the server (which recomputes on
    write so a stale/tampered client can never persist wrong numbers).

    Mirrors pcd_refresh_qty_fields():
      pipe_calculated_qty = L*W*D                        (Total Excavation)
      pipe_volume         = (3.14*d^2/4)*L
      hard/soft/cc_qty    = L*W*D
      murum_qty           = L*W*D  but only if include_murum
      soil_excavation_qty = pipe_calculated_qty - cc - soft - hard
      total_excavation    = soft + hard + cc             (internal, -> pipe row)
    """
    pipe_calculated_qty = calc_qty(v.get("pipe_length"), v.get("pipe_width"), v.get("pipe_depth"))
    pipe_volume = calc_pipe_volume(v.get("pipe_details"), v.get("pipe_length"))

    hard_qty = calc_qty(v.get("hard_length"), v.get("hard_width"), v.get("hard_depth"))
    soft_qty = calc_qty(v.get("soft_length"), v.get("soft_width"), v.get("soft_depth"))
    cc_qty = calc_qty(v.get("cc_length"), v.get("cc_width"), v.get("cc_depth"))

    include_murum = cint(v.get("include_murum"))
    murum_qty = calc_qty(v.get("murum_length"), v.get("murum_width"), v.get("murum_depth")) if include_murum else 0.0

    return {
        "pipe_calculated_qty": pipe_calculated_qty,
        "pipe_volume": pipe_volume,
        "hard_qty": hard_qty,
        "soft_qty": soft_qty,
        "cc_qty": cc_qty,
        "murum_qty": murum_qty,
        "soil_excavation_qty": pipe_calculated_qty - cc_qty - soft_qty - hard_qty,
        "total_excavation": soft_qty + hard_qty + cc_qty,
    }


def _validate_lengths(v):
    """No sub-length may exceed the pipe length (mirrors pcd_validate_all_lengths).

    The desk script silently zeroes an offending field; on the server we reject
    instead, so a bad offline entry surfaces as an error the user can fix rather
    than silently losing the number they typed.
    """
    pipe_length = flt(v.get("pipe_length"))
    if not pipe_length:
        return

    for fieldname, label in (
        ("hard_length", "Hard Rock"),
        ("soft_length", "Soft Rock"),
        ("murum_length", "Murum"),
        ("soil_length", "Soil Details"),
        ("cc_length", "CC Road Breaking"),
    ):
        value = flt(v.get(fieldname))
        if value and value > pipe_length:
            frappe.throw(
                _("{0} Length ({1}) cannot be greater than Total Pipe Length ({2}).").format(
                    label, value, pipe_length
                ),
                title=_("Invalid Length"),
            )


def _next_common_pipe_id(doc):
    """Next PIPE-00n, shared by every row this batch writes.

    Scans this document's rows plus every existing row across all Pour Cards, so
    the id stays globally unique (mirrors pcd_get_next_common_pipe_id).
    """
    max_id = 0

    def scan(pipe_id):
        nonlocal max_id
        if not pipe_id:
            return
        text = str(pipe_id).strip()
        if text.startswith("PIPE-"):
            tail = text[5:]
            if tail.isdigit():
                max_id = max(max_id, int(tail))

    parentfields = [TABLES[k] for k in ("pipe", "hard", "soft", "murum", "soil", "acc")]

    for parentfield in parentfields:
        for row in doc.get(parentfield) or []:
            scan(row.get("pipe_id"))

    meta = frappe.get_meta("Pour Card")
    for parentfield in parentfields:
        df = meta.get_field(parentfield)
        if not df or not df.options:
            continue
        try:
            for row in frappe.get_all(
                df.options,
                filters={"pipe_id": ["is", "set"], "parenttype": "Pour Card"},
                fields=["pipe_id"],
                limit_page_length=0,
            ):
                scan(row.get("pipe_id"))
        except Exception:
            frappe.log_error(frappe.get_traceback(), "PLM: pipe_id scan failed for " + df.options)

    return "PIPE-{0:03d}".format(max_id + 1)


def _batch_already_applied(pour_card, batch_uid):
    """True if this batch uid was already written (offline-replay guard)."""
    if not batch_uid:
        return False
    return bool(
        frappe.db.exists(
            "Comment",
            {
                "comment_type": "Info",
                "reference_doctype": "Pour Card",
                "reference_name": pour_card,
                "content": BATCH_LEDGER_PREFIX + str(batch_uid),
            },
        )
    )


def _ledger_batch(pour_card, batch_uid, pipe_id):
    """Record the batch uid so a replay is recognised. Durable + shows in the
    desk timeline, which doubles as an audit trail for mobile entries."""
    if not batch_uid:
        return
    frappe.get_doc(
        {
            "doctype": "Comment",
            "comment_type": "Info",
            "reference_doctype": "Pour Card",
            "reference_name": pour_card,
            "content": BATCH_LEDGER_PREFIX + str(batch_uid),
            "published": 0,
        }
    ).insert(ignore_permissions=True)

    if pipe_id:
        frappe.get_doc(
            {
                "doctype": "Comment",
                "comment_type": "Comment",
                "reference_doctype": "Pour Card",
                "reference_name": pour_card,
                "content": _("Laying details added from mobile app as {0}.").format(pipe_id),
            }
        ).insert(ignore_permissions=True)


def _row_has_value(data):
    """Skip empty child rows (mirrors pcd_add_child_row's has_value check)."""
    for key, value in (data or {}).items():
        if value in (None, ""):
            continue
        if key in ("pipe_id", "date", "date_of_pipelaying", "date_soft_rock",
                   "hard_rocks_date", "date_of_cc_road", "date_accessories"):
            return True
        try:
            if flt(value) != 0:
                return True
        except (TypeError, ValueError):
            return True
    return False


def _append(doc, parentfield, data):
    if _row_has_value(data):
        doc.append(parentfield, data)


def _recalc_total_quantity(doc):
    """total_quantity = sum(items.qauntity) — mirrors the desk client script,
    which only runs in the browser, so the server must do it for mobile writes."""
    doc.total_quantity = sum(cint(r.qauntity) for r in (doc.get(TABLES["acc"]) or []))


def _find_duplicate(header, company, exclude=None):
    """Existing non-cancelled card with the same natural key, if any."""
    values = dict(header)
    values["company"] = company

    if not all(values.get(f) for f in DUP_KEY):
        return None

    filters = {f: values[f] for f in DUP_KEY}
    filters["docstatus"] = ["<", 2]
    if exclude:
        filters["name"] = ["!=", exclude]

    return frappe.db.exists("Pour Card", filters)


def _clean_junction(value, label):
    """From/To Junction are digits-only (mirrors the 'From jn , To jn' and
    'Pour Card From,To Junction rule' desk scripts)."""
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text.isdigit():
        frappe.throw(
            _("{0} must be a whole number (digits only).").format(label),
            title=_("Invalid Junction"),
        )
    return text


def _card_summary(row):
    return {
        "name": row.get("name"),
        "project": row.get("townproject"),
        "zone": row.get("zone_name"),
        "village": row.get("village_name"),
        "component": row.get("component"),
        "contractor": row.get("select_contractor"),
        "from_junction": row.get("from_junction"),
        "to_junction": row.get("to_junction"),
        "docstatus": cint(row.get("docstatus")),
        "material_issue": row.get("material_issue"),
        "total_quantity": flt(row.get("total_quantity")),
        "modified": str(row.get("modified") or ""),
        "owner": row.get("owner"),
    }


# ---------------------------------------------------------------- read API

@frappe.whitelist()
def ping():
    """Cheap connectivity + session probe used by the sync engine."""
    return {"ok": True, "user": frappe.session.user, "app": "pipe_laying_inhouse"}


@frappe.whitelist()
def capabilities():
    """Per-user UI flags. UI gating ONLY — never a security boundary."""
    return {
        "user": frappe.session.user,
        "full_name": get_fullname(frappe.session.user),
        "roles": frappe.get_roles(),
        "read": bool(frappe.has_permission("Pour Card", "read")),
        "create": bool(frappe.has_permission("Pour Card", "create")),
        "write": bool(frappe.has_permission("Pour Card", "write")),
        "submit": bool(frappe.has_permission("Pour Card", "submit")),
        "cancel": bool(frappe.has_permission("Pour Card", "cancel")),
        "default_company": _default_company(),
    }


@frappe.whitelist()
def get_masters():
    """Every dropdown the app needs, in one round trip, cached offline.

    Read straight from the DB with the real link fields (verified against live
    meta), so masters added or renamed in the backend appear in the app on the
    next refresh with no deploy and no APK rebuild:

      Site Project                 name
      Zone Details                 town_project -> Site Project
      Pipe Laying Village Details  townproject  -> Site Project
                                   zone_name    -> Zone Details (often unset)
      Component at Site            project      -> Site Project
      Contractor at Site           project      -> Site Project

    `rev` changes whenever any master row is touched, letting the client skip
    the payload when nothing moved.
    """
    _require("read")

    def newest(doctype):
        value = frappe.db.sql(
            "select max(modified) from `tab{0}`".format(doctype)  # nosec: fixed names
        )[0][0]
        return str(value or "")

    doctypes = [
        "Site Project", "Zone Details", "Pipe Laying Village Details",
        "Component at Site", "Contractor at Site", "Item",
    ]
    rev = "|".join(
        "{0}:{1}:{2}".format(dt, frappe.db.count(dt), newest(dt)) for dt in doctypes
    )

    return {
        "rev": rev,
        "fetched_at": frappe.utils.now(),
        # get_list (NOT get_all) so the user's User Permissions apply, exactly
        # like the desk link fields: a user restricted to a Site Project sees
        # only that site here, and — because a Site Project user-permission with
        # apply_to_all_doctypes propagates to every doctype that links to it —
        # only that site's zones / villages / components / contractors too.
        # An unrestricted user (no Site Project user-permission) still sees all.
        "projects": frappe.get_list("Site Project", fields=["name"], order_by="name", limit_page_length=0),
        "zones": frappe.get_list(
            "Zone Details",
            fields=["name", "town_project as project"],
            order_by="name",
            limit_page_length=0,
        ),
        "villages": frappe.get_list(
            "Pipe Laying Village Details",
            fields=["name", "townproject as project", "zone_name as zone"],
            order_by="name",
            limit_page_length=0,
        ),
        "components": frappe.get_list(
            "Component at Site",
            fields=["name", "project"],
            order_by="name",
            limit_page_length=0,
        ),
        "contractors": frappe.get_list(
            "Contractor at Site",
            fields=["name", "project", "contractor"],
            order_by="name",
            limit_page_length=0,
        ),
        "pipe_items": frappe.get_all(
            "Item",
            filters={"item_group": ["in", PIPE_ITEM_GROUPS], "disabled": 0},
            fields=["name", "item_name", "item_group", "stock_uom"],
            order_by="item_group, name",
            limit_page_length=0,
        ),
        "acc_items": frappe.get_all(
            "Item",
            filters={"item_group": ["in", ACC_ITEM_GROUPS], "disabled": 0},
            fields=["name", "item_name", "item_group", "stock_uom"],
            order_by="item_group, name",
            limit_page_length=0,
        ),
        "companies": frappe.get_all("Company", fields=["name", "abbr"], limit_page_length=0),
    }


@frappe.whitelist()
def mt_masters():
    """Warehouses + companies for the Material Transfer screen.

    get_list (not get_all) so the user's User Permissions apply — a user scoped
    to a Company sees only that company's warehouses, exactly like the desk
    Warehouse link field. `can_create`/`can_submit` mirror the real Stock Entry
    permission gates (save/submit enforce them server-side regardless).
    """
    _require("read")

    return {
        "warehouses": frappe.get_list(
            "Warehouse",
            filters={"is_group": 0, "disabled": 0},
            fields=["name", "warehouse_name", "company"],
            order_by="name",
            limit_page_length=0,
        ),
        "companies": frappe.get_list(
            "Company", fields=["name", "abbr"], order_by="name", limit_page_length=0
        ),
        "default_company": frappe.defaults.get_user_default("company") or _default_company(),
        "can_create": bool(frappe.has_permission("Stock Entry", "create")),
        "can_submit": bool(frappe.has_permission("Stock Entry", "submit")),
    }


@frappe.whitelist()
def item_search(q=None, limit=25):
    """Server-side Item search for the transfer item picker — there are 3000+
    items, far too many to ship to the phone. Matches item code or name,
    permission-scoped via get_list."""
    _require("read")

    text = (q or "").strip()
    filters = {"disabled": 0}
    or_filters = None
    if text:
        like = "%{0}%".format(text)
        or_filters = {"name": ["like", like], "item_name": ["like", like]}

    return frappe.get_list(
        "Item",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "item_name", "stock_uom", "item_group"],
        order_by="modified desc",
        limit_page_length=cint(limit) or 25,
    )


@frappe.whitelist()
def list_cards(search=None, status=None, project=None, limit=200, start=0):
    """Pour Card list screen. Permission-scoped: get_list only returns rows the
    session user may read, so calling this endpoint directly leaks nothing."""
    _require("read")

    filters = {}
    if project:
        filters["townproject"] = project

    if status == "draft":
        filters["docstatus"] = 0
    elif status == "submitted":
        filters["docstatus"] = 1
    elif status == "cancelled":
        filters["docstatus"] = 2

    or_filters = None
    if search:
        like = "%{0}%".format(search)
        or_filters = {
            "name": ["like", like],
            "townproject": ["like", like],
            "zone_name": ["like", like],
            "village_name": ["like", like],
            "select_contractor": ["like", like],
            "from_junction": ["like", like],
            "to_junction": ["like", like],
        }

    rows = frappe.get_list(
        "Pour Card",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name", "townproject", "zone_name", "village_name", "component",
            "select_contractor", "from_junction", "to_junction", "docstatus",
            "material_issue", "total_quantity", "modified", "owner",
        ],
        order_by="modified desc",
        limit_start=cint(start),
        limit_page_length=cint(limit),
    )

    return [_card_summary(r) for r in rows]


@frappe.whitelist()
def home_summary():
    """Dashboard counts for the Home screen."""
    _require("read")

    def count(extra=None):
        filters = dict(extra or {})
        return len(
            frappe.get_list(
                "Pour Card", filters=filters, fields=["name"], limit_page_length=0
            )
        )

    return {
        "total": count(),
        "draft": count({"docstatus": 0}),
        "submitted": count({"docstatus": 1}),
        "cancelled": count({"docstatus": 2}),
        "recent": [
            _card_summary(r)
            for r in frappe.get_list(
                "Pour Card",
                fields=[
                    "name", "townproject", "zone_name", "village_name", "component",
                    "select_contractor", "from_junction", "to_junction", "docstatus",
                    "material_issue", "total_quantity", "modified", "owner",
                ],
                order_by="modified desc",
                limit_page_length=5,
            )
        ],
    }


@frappe.whitelist()
def get_card(name):
    """Card detail screen: header + every child table, grouped by Pipe ID."""
    _require("read")

    doc = frappe.get_doc("Pour Card", name)
    doc.check_permission("read")

    def rows(parentfield, fields):
        out = []
        for row in doc.get(parentfield) or []:
            item = {f: row.get(f) for f in fields}
            item["idx"] = row.idx
            item["pipe_id"] = row.get("pipe_id")
            for key, value in list(item.items()):
                if hasattr(value, "isoformat"):
                    item[key] = str(value)
            out.append(item)
        return out

    detail = {
        "name": doc.name,
        "docstatus": cint(doc.docstatus),
        "project": doc.townproject,
        "zone": doc.zone_name,
        "village": doc.village_name,
        "component": doc.component,
        "contractor": doc.select_contractor,
        "from_junction": doc.from_junction,
        "to_junction": doc.to_junction,
        "company": doc.company,
        "material_issue": doc.material_issue,
        "total_quantity": flt(doc.total_quantity),
        "excavation_qty_cum": flt(doc.excavation_qty_cum),
        "attachment": doc.get("attach_jojl"),
        "owner": doc.owner,
        "modified": str(doc.modified),
        "can_write": bool(frappe.has_permission("Pour Card", "write", doc)),
        "can_submit": bool(frappe.has_permission("Pour Card", "submit", doc)),
        "pipe": rows(TABLES["pipe"], [
            "date_of_pipelaying", "pipe_details", "length_of_pipemtr",
            "width_of_pipemtr", "depth_of_pipemtr", "pipe_calculated_qty",
            "custom_bedding", "murum_churibedding", "strata_name", "attachment",
        ]),
        "soft": rows(TABLES["soft"], ["date_soft_rock", "lengthmtr", "widthmtr", "depthmtr"]),
        "hard": rows(TABLES["hard"], [
            "hard_rocks_date", "hard_rock_lengthmtr", "hard_rock_widthmtr", "hard_rock_depthmtr",
        ]),
        "murum": rows(TABLES["murum"], [
            "hard_rocks_date", "hard_rock_lengthmtr", "hard_rock_widthmtr", "hard_rock_depthmtr",
        ]),
        "cc": rows(TABLES["cc"], [
            "date_of_cc_road", "cc_road_badding_length",
            "cc_road_badding_width", "cc_road_breaking_depth",
        ]),
        "soil": rows(TABLES["soil"], [
            "date", "lengthmtr", "widthmtr", "depthmtr", "soil_excavation_qty",
        ]),
        "acc": rows(TABLES["acc"], ["date_accessories", "accessories", "qauntity"]),
    }

    # Backfilling lives on a Custom Field, which may be absent on some sites.
    if frappe.get_meta("Pour Card").get_field(TABLES["backfill"]):
        detail["backfill"] = rows(TABLES["backfill"], [
            "date", "pipe_details", "diameter_mm", "length", "width", "depth",
            "total_excavation", "murum_qty", "pipe_volume", "backfilling_qty",
        ])
    else:
        detail["backfill"] = []

    return detail


# ---------------------------------------------------------------- write API

@frappe.whitelist()
def save_card(payload):
    """Create or update a Pour Card header (draft).

    Idempotent for offline replay: before creating, look for an existing
    non-cancelled card with the same natural key (the same 8 fields
    pour_card.py's validate() rejects duplicates on). A replayed create resolves
    to that card instead of throwing or duplicating.

    Returns {name, docstatus, created} so the client can remap its local id.
    """
    data = _parse(payload)

    header = {f: (data.get(f) or None) for f in HEADER_FIELDS}
    header["from_junction"] = _clean_junction(header["from_junction"], _("From Junction"))
    header["to_junction"] = _clean_junction(header["to_junction"], _("To Junction"))

    if header["from_junction"] and header["from_junction"] == header["to_junction"]:
        frappe.throw(
            _("From Junction and To Junction cannot be the same."),
            title=_("Invalid Junction"),
        )

    company = data.get("company") or _default_company()
    name = data.get("name")

    if name and frappe.db.exists("Pour Card", name):
        doc = frappe.get_doc("Pour Card", name)
        doc.check_permission("write")
        if cint(doc.docstatus) != 0:
            # Submitted or cancelled: header is locked. Report, don't fail the
            # queue — the card already exists in the state the user wanted.
            return {
                "name": doc.name,
                "docstatus": cint(doc.docstatus),
                "created": False,
                "locked": True,
            }
        created = False
    else:
        _require("create")
        existing = _find_duplicate(header, company)
        if existing:
            return {
                "name": existing,
                "docstatus": cint(frappe.db.get_value("Pour Card", existing, "docstatus")),
                "created": False,
                "deduped": True,
            }
        doc = frappe.new_doc("Pour Card")
        created = True

    for field, value in header.items():
        doc.set(field, value)

    doc.company = company

    if data.get("attachment"):
        doc.attach_jojl = data["attachment"]

    doc.save()
    frappe.db.commit()

    return {"name": doc.name, "docstatus": cint(doc.docstatus), "created": created}


@frappe.whitelist()
def add_laying_batch(pour_card, values, batch_uid=None):
    """Add one 'Pour Card Details' batch — the app's core write.

    Writes one row into each of the pipe / hard / soft / murum / soil / cc /
    accessories child tables, all sharing one generated Pipe ID, exactly as the
    live desk popup does. All derived quantities are RECOMPUTED here from the
    raw L/W/D the client sent, so the numbers stored can't drift from the
    formulas even if the client is stale or offline-cached.

    `batch_uid` makes this safe to replay from the offline outbox: the uid is
    ledgered as a Comment on the card and a repeat is skipped.
    """
    v = _parse(values)

    doc = frappe.get_doc("Pour Card", pour_card)
    doc.check_permission("write")

    if cint(doc.docstatus) == 2:
        frappe.throw(_("Cannot add details to a cancelled Pour Card."))

    if _batch_already_applied(doc.name, batch_uid):
        return {
            "name": doc.name,
            "docstatus": cint(doc.docstatus),
            "pipe_id": None,
            "skipped": True,
            "reason": "already_applied",
        }

    if not v.get("date"):
        frappe.throw(_("Date is required."))
    if not (flt(v.get("pipe_length")) and flt(v.get("pipe_width")) and flt(v.get("pipe_depth"))):
        frappe.throw(_("Please fill Length, Width and Depth."))
    if cint(v.get("include_murum")) and not (
        flt(v.get("murum_length")) and flt(v.get("murum_width")) and flt(v.get("murum_depth"))
    ):
        frappe.throw(_("Please fill Murum Length, Width and Depth."))

    _validate_lengths(v)

    totals = derive_laying_totals(v)
    pipe_id = _next_common_pipe_id(doc)
    date = v.get("date")

    # A submitted card can still take new child rows (this is how the desk popup
    # works too); allow_on_submit is honoured per-field by Frappe.
    if cint(doc.docstatus) == 1:
        doc.flags.ignore_validate_update_after_submit = True

    _append(doc, TABLES["pipe"], {
        "pipe_id": pipe_id,
        "date_of_pipelaying": date,
        "pipe_details": v.get("pipe_details"),
        "length_of_pipemtr": flt(v.get("pipe_length")),
        "width_of_pipemtr": flt(v.get("pipe_width")),
        "depth_of_pipemtr": flt(v.get("pipe_depth")),
        "pipe_calculated_qty": totals["pipe_calculated_qty"],
        "custom_bedding": flt(v.get("bedding_depth")),
        "murum_churibedding": "Yes" if cint(v.get("include_murum")) else "No",
        "strata_name": v.get("strata_name") or None,
    })

    _append(doc, TABLES["hard"], {
        "pipe_id": pipe_id,
        "hard_rocks_date": date,
        "hard_rock_lengthmtr": flt(v.get("hard_length")),
        "hard_rock_widthmtr": flt(v.get("hard_width")),
        "hard_rock_depthmtr": flt(v.get("hard_depth")),
    })

    _append(doc, TABLES["soft"], {
        "pipe_id": pipe_id,
        "date_soft_rock": date,
        "lengthmtr": flt(v.get("soft_length")),
        "widthmtr": flt(v.get("soft_width")),
        "depthmtr": flt(v.get("soft_depth")),
    })

    if cint(v.get("include_murum")):
        _append(doc, TABLES["murum"], {
            "pipe_id": pipe_id,
            "hard_rocks_date": date,
            "hard_rock_lengthmtr": flt(v.get("murum_length")),
            "hard_rock_widthmtr": flt(v.get("murum_width")),
            "hard_rock_depthmtr": flt(v.get("murum_depth")),
        })

    _append(doc, TABLES["soil"], {
        "pipe_id": pipe_id,
        "date": date,
        "soil_excavation_qty": totals["soil_excavation_qty"],
    })

    _append(doc, TABLES["cc"], {
        "pipe_id": pipe_id,
        "date_of_cc_road": date,
        "cc_road_badding_length": flt(v.get("cc_length")),
        "cc_road_badding_width": flt(v.get("cc_width")),
        "cc_road_breaking_depth": flt(v.get("cc_depth")),
    })

    if v.get("accessories") and cint(v.get("accessories_qty")) > 0:
        doc.append(TABLES["acc"], {
            "pipe_id": pipe_id,
            "date_accessories": date,
            "accessories": v.get("accessories"),
            "qauntity": cint(v.get("accessories_qty")),
        })

    _recalc_total_quantity(doc)

    doc.save()

    _ledger_batch(doc.name, batch_uid, pipe_id)
    frappe.db.commit()

    return {
        "name": doc.name,
        "docstatus": cint(doc.docstatus),
        "pipe_id": pipe_id,
        "totals": totals,
        "total_quantity": flt(doc.total_quantity),
    }


@frappe.whitelist()
def submit_card(name):
    """Submit a Pour Card.

    Submitting fires the existing on_submit hook, which creates and submits the
    Material Issue Stock Entry from the contractor warehouse. That needs live
    stock, so it only ever runs online — the offline queue holds the intent and
    replays it here. Idempotent: an already-submitted card returns its state.
    """
    doc = frappe.get_doc("Pour Card", name)

    if cint(doc.docstatus) == 1:
        return {
            "name": doc.name, "docstatus": 1,
            "material_issue": doc.material_issue, "skipped": True,
        }
    if cint(doc.docstatus) == 2:
        frappe.throw(_("Pour Card {0} is cancelled and cannot be submitted.").format(name))

    doc.check_permission("submit")

    _recalc_total_quantity(doc)
    doc.save()
    doc.submit()
    frappe.db.commit()

    doc.reload()
    return {
        "name": doc.name,
        "docstatus": cint(doc.docstatus),
        "material_issue": doc.material_issue,
    }


@frappe.whitelist()
def calc_backfilling(pour_card, rows=None, date=None, save=0):
    """Backfilling calculator for the selected pipe rows.

    Formulas mirror the live 'Pour Card Backfilling Button' script:
        Total Excavation = L * W * D
        Murum            = L * W * Bedding Depth
        Pipe Volume      = (3.14 * d^2 / 4) * L
        Backfilling      = Total Excavation - Murum - Pipe Volume

    The desk button only calculates and displays — it never persists. Default
    here matches that (save=0). Pass save=1 to also write the rows into the
    Backfilling Details table, which the desk leaves empty.
    """
    _require("read")

    doc = frappe.get_doc("Pour Card", pour_card)
    doc.check_permission("read")

    wanted = _parse(rows) if rows else None
    if isinstance(wanted, dict):
        wanted = wanted.get("rows")

    out = []
    for row in doc.get(TABLES["pipe"]) or []:
        if wanted and row.get("pipe_id") not in wanted and row.idx not in wanted:
            continue

        length = flt(row.get("length_of_pipemtr"))
        width = flt(row.get("width_of_pipemtr"))
        depth = flt(row.get("depth_of_pipemtr"))
        # Bedding lives on the custom field `custom_bedding` (label "Bedding").
        # The desk backfilling script finds it by label match; we address it
        # directly. NOTE the repo's api.py and the "Show Bedding Field" client
        # script both reference `bedding_depthmtr`, which does not exist on this
        # site — those writes are silently dropped.
        bedding = flt(row.get("custom_bedding"))

        diameter_mm = extract_diameter_mm(row.get("pipe_details"))
        diameter_m = diameter_mm / 1000.0

        total_excavation = length * width * depth
        murum_qty = length * width * bedding
        pipe_volume = (3.14 * diameter_m * diameter_m / 4.0) * length

        out.append({
            "idx": row.idx,
            "pipe_id": row.get("pipe_id"),
            "date": date or str(row.get("date_of_pipelaying") or ""),
            "pipe_details": row.get("pipe_details"),
            "diameter_mm": diameter_mm,
            "length": length,
            "width": width,
            "depth": depth,
            "bedding_depth": bedding,
            "total_excavation": total_excavation,
            "murum_qty": murum_qty,
            "pipe_volume": pipe_volume,
            "backfilling_qty": total_excavation - murum_qty - pipe_volume,
        })

    result = {
        "rows": out,
        "totals": {
            key: sum(r[key] for r in out)
            for key in ("total_excavation", "murum_qty", "pipe_volume", "backfilling_qty")
        },
        "saved": False,
    }

    if cint(save) and out:
        if not frappe.get_meta("Pour Card").get_field(TABLES["backfill"]):
            frappe.throw(_("Backfilling Details table is not available on this site."))

        doc.check_permission("write")
        if cint(doc.docstatus) == 1:
            doc.flags.ignore_validate_update_after_submit = True

        doc.set(TABLES["backfill"], [])
        for r in out:
            doc.append(TABLES["backfill"], {
                "date": r["date"] or nowdate(),
                "pipe_id": r["pipe_id"],
                "pipe_details": r["pipe_details"],
                "diameter_mm": r["diameter_mm"],
                "length": r["length"],
                "width": r["width"],
                "depth": r["depth"],
                "total_excavation": r["total_excavation"],
                "murum_qty": r["murum_qty"],
                "pipe_volume": r["pipe_volume"],
                "backfilling_qty": r["backfilling_qty"],
            })

        doc.save()
        frappe.db.commit()
        result["saved"] = True

    return result


@frappe.whitelist()
def check_duplicate(payload):
    """Live 'this junction pair already exists' check for the New Card screen.

    Same rule the server enforces on save, surfaced early so a field user finds
    out before typing the rest — and before an offline entry is queued.
    """
    _require("read")

    data = _parse(payload)
    header = {f: (data.get(f) or None) for f in HEADER_FIELDS}
    company = data.get("company") or _default_company()

    if header["from_junction"] and header["from_junction"] == header["to_junction"]:
        return {"duplicate": None, "same_junction": True}

    existing = _find_duplicate(header, company, exclude=data.get("name"))
    return {"duplicate": existing, "same_junction": False}


@frappe.whitelist()
def sync_batch(ops):
    """Replay a queued outbox in one round trip.

    Each op is {id, kind, ...}. Ops run in order and each result carries the
    client's op id, so the client can retire exactly the ops that landed and
    keep the rest queued. One failing op does not abort the ones behind it —
    field users routinely have a bad entry sitting in front of good ones.

    A card created offline has no Pour Card name yet, so the client references it
    by a placeholder ("NEW-…"). Ops carry `local_name`, and this function keeps a
    map from placeholder to the real name as it goes — so "create a card, add two
    batches, submit it", all recorded with no signal, replays in ONE round trip.
    """
    operations = _parse(ops)
    if isinstance(operations, dict):
        operations = operations.get("ops") or []

    results = []
    resolved = {}  # placeholder name -> real Pour Card name

    def real_name(reference):
        """Map a client placeholder to the real name, if we've seen it."""
        if reference and reference in resolved:
            return resolved[reference]
        return reference

    for op in operations:
        op_id = op.get("id")
        kind = op.get("kind")

        try:
            if kind == "save_card":
                data = dict(op.get("payload") or {})
                local_name = op.get("local_name") or data.get("name")

                # A placeholder is not a server name — drop it so save_card
                # creates (or dedupes onto) a real card.
                if data.get("name") and str(data["name"]).startswith("NEW-"):
                    data.pop("name", None)
                if local_name and local_name in resolved:
                    data["name"] = resolved[local_name]

                out = save_card(json.dumps(data))

                if local_name:
                    resolved[local_name] = out["name"]

            elif kind == "add_laying_batch":
                target = real_name(op.get("pour_card"))
                if not target or str(target).startswith("NEW-"):
                    raise frappe.ValidationError(
                        _("The Pour Card for this entry has not been created yet.")
                    )
                out = add_laying_batch(
                    target,
                    json.dumps(op.get("values") or {}),
                    batch_uid=op.get("batch_uid") or op_id,
                )

            elif kind == "submit_card":
                target = real_name(op.get("pour_card"))
                if not target or str(target).startswith("NEW-"):
                    raise frappe.ValidationError(
                        _("The Pour Card for this entry has not been created yet.")
                    )
                out = submit_card(target)

            else:
                raise frappe.ValidationError(_("Unknown operation: {0}").format(kind))

            results.append({"id": op_id, "kind": kind, "ok": True, "result": out})

        except Exception as exc:
            # Roll back only this op's partial writes, then keep going.
            frappe.db.rollback()
            frappe.log_error(frappe.get_traceback(), "PLM sync_batch: " + str(kind))
            results.append({
                "id": op_id,
                "kind": kind,
                "ok": False,
                "error": str(exc),
                "error_type": type(exc).__name__,
                "permanent": isinstance(exc, (frappe.PermissionError, frappe.ValidationError)),
            })

    return {
        "results": results,
        "resolved": resolved,
        "server_time": frappe.utils.now(),
    }
