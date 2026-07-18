# Audit prompt — verify all checklist templates after commit `0d5b1b0`

Hand this to Codex, Claude Code, or any other coding agent. It is self-contained: it assumes **no**
knowledge of the conversation that produced the changes.

> **Read this first, whoever you are.** Three static code audits have already run against this
> change (a feasibility audit, a pre-change baseline of all templates, and a 10-agent regression
> audit). Re-reading the diff and declaring it fine adds nothing. **The remaining risk is runtime
> and data**: what actually happens in a browser against the live database, and what state existing
> jobs are in. Weight your effort accordingly. If you cannot reach a running app or the database,
> say so plainly rather than substituting more static analysis and calling it verification.

---

## 1. Context

**Repo:** Taylor Engineering Checklist Platform — Next.js 16 (App Router) + Supabase
(Postgres + RLS + Storage), TypeScript, offline-first PWA.
Roles: admin / surveyor / client / office. Schema lives in `supabase/migrations/*.sql`
(numbered, idempotent, auto-applied on push by the `db-migrate` GitHub Action).

**Commit under audit:** `0d5b1b0` — "Brine Transfer Checklist (mig 137) + manual item numbering +
per-template diff unit". Diff it with `git show 0d5b1b0`.

**Do not use `graphify query` / `graphify path` for data-flow questions** — the graph is undirected
and every traversal collapses toward the `createClient()` hub. Use `grep`/`Read`. Never conclude
code is unused from the graph; JSX usage and type-only imports produce no edge.

---

## 2. What changed

Three code changes plus one new template. Each was deliberately scoped so existing templates keep
their current behaviour — **your job is to test whether that scoping actually holds.**

**Change A — `formatDiffPercentage` gained a unit.**
`src/lib/utils/index.ts` — signature is now `(rawDiff, denominatorStr, unit = 'USG')`, and the
output string interpolates `unit` instead of a hardcoded `"USG"`. Threaded through
`src/components/job/FieldRenderer.tsx` (passes `field.unit || undefined`) and
`src/lib/pdf/JobPDF.tsx` (`CalcDiffCell` gained a `unit` prop).
*Intended invariant:* any calculated field whose `unit` is null/empty still prints `USG`.

**Change B — per-template manual item numbering.**
New `checklist_templates.manual_numbering BOOLEAN NOT NULL DEFAULT false`. Numbering logic extracted
to `src/lib/checklist/itemNumbering.ts` (`itemNumberFor`, `applyItemNumbering`). Previously
`renumberFields` in `TemplateBuilder.tsx` re-stamped every field's `item_number` to `1..n`
**per section, on any field patch** — a one-character label edit was enough. With the flag on, stored
numbers are preserved and `FieldEditor` shows an editable item-number box. `order_index` is still
always re-stamped. Migration 137 sets the flag `true` for Brine Transfer and for any template whose
name matches `ILIKE '%fuel transfer%'`.
*Intended invariant:* templates with the flag `false` (Ultrasonic, OVID, Borescoping) number exactly
as before.

**Change C — answers are cleared when conditional logic hides their field.**
New `src/lib/checklist/clearHidden.ts` (`clearHiddenAnswers`), called from `updateValue` in
`src/components/job/JobChecklistEditor.tsx`. Previously a hidden field kept its stored answer, which
still fed every conditional referencing it and still printed in the PDF.
*Two guards that must not be removed:*
- It runs **only on a user edit**, never in an effect — during load every value starts empty, so
  every dependent field would look hidden and a completed checklist would be wiped.
- It is **skipped when the new value is empty**. A `<input type="number">` passes through `''` on
  every keystroke and `parseFloat('') > 0` is `false`, so an empty numeric parent reads as hiding
  everything it gates. Without this guard, backspacing Ultrasonic's "Number of holds" blanks up to
  30 Hold/Bilge answers across every test round.
`handleSave` also now skips recomputing calculated fields that are currently hidden.

**New template — Brine Transfer Checklist**, `supabase/migrations/137_brine_transfer_checklist.sql`.
Seeded as **`draft`**, so it is invisible to users until an admin activates it.

---

## 3. The templates that exist

| Template | Id / how to find it | Seeded by | `manual_numbering` |
|---|---|---|---|
| Ultrasonic Hatch Testing | `75480000-0000-4000-8000-000000000001` | mig 072 (+074/109/112/113) | false |
| OVID Survey | `0a1d0000-0000-4000-8000-000000000001` | mig 086 (+089/091) | false |
| Daily Borescoping Report | `b0235c09-0000-4000-8000-000000000001` | mig 093 (+094–105) | false |
| BPTT LLC - Fuel Transfer Checklist | name match only | **DB only** (patched by 007/118/127/128) | **true** (new) |
| Fuel Transfer Checklist (generic) | name match only | **DB only** | **true** (new) |
| Brine Transfer Checklist | `b21e0000-0000-4000-8000-000000000001` | **mig 137 (new)** | true |

**Critical:** the two Fuel Transfer templates were built in the admin Template Builder and exist
**only as rows in the live database**. No seed SQL for them is in the repo. Their original seed was
deleted and is recoverable at:

```
git show c832246^:supabase/migrations/017_seed_fuel_transfer_checklist.sql
```

(note the `^` — the file does not exist at `c832246` itself). That file is the reference for the
reconciliation structure and the `C1A`..`C1D` numbering. **Anything you want to know about the live
fuel templates must come from the database, not the repo.**

---

## 4. What to do

Structure the work as a workflow with independent verification. Do **not** let one agent both make a
claim and confirm it.

### Phase 1 — Establish live DB truth (read-only SQL)

Everything below is read-only. Run it and report the actual rows; do not assume.

```sql
-- Register: which templates exist, their flags, and their status
select id, name, status, manual_numbering, requires_report_number,
       default_job_type, pdf_include_photos
from checklist_templates order by name;

-- Numbering: what item numbers are actually stored, per template
select t.name, s.title, f.item_number, f.order_index, f.label, f.field_type
from template_fields f
join template_sections s on s.id = f.section_id
join checklist_templates t on t.id = f.template_id
order by t.name, s.order_index, f.order_index;

-- Every calculated field and its unit — Change A's blast radius
select t.name, f.label, f.unit, f.validation, f.calculation_formula
from template_fields f join checklist_templates t on t.id = f.template_id
where f.field_type = 'calculated';

-- Every conditional rule in the system — Change C's blast radius
select t.name, f.item_number, f.label, f.conditional_logic
from template_fields f join checklist_templates t on t.id = f.template_id
where f.conditional_logic is not null;

-- Pre-existing stale hidden answers: values stored for fields that are currently
-- hidden. These pre-date the change; Change C stops NEW ones accruing.
-- Report the count per template; do NOT modify anything.
select t.name, count(*) from job_field_values v
join template_fields f on f.id = v.field_id
join checklist_templates t on t.id = f.template_id
where f.conditional_logic is not null and coalesce(v.value,'') <> ''
group by t.name;
```

Answer explicitly:
- Do the two Fuel Transfer templates now have `manual_numbering = true`? Did the `ILIKE` match
  anything it should not have?
- Are their stored item numbers currently **correct**, or already mangled by past auto-renumbering?
  They are now frozen, so anything wrong needs repairing by SQL or via the new item-number box.
- Does any calculated field have a `unit` that is **not** USG and **not** BBLS? Change A means such
  a field's printed unit changes. Name it.

### Phase 2 — Runtime verification (this is the part that matters)

Drive the actual app. For each check, state **PASS / FAIL / NOT TESTED** and say how you observed it.
"The code looks correct" is NOT a pass.

**Regression — must behave exactly as before the change:**

1. **Ultrasonic, the data-loss case.** Open a job with several holds and answered Hold/Bilge fields.
   Backspace "Number of holds" to empty, then retype it. **All Hold/Bilge answers in all test rounds
   must survive.** Reload and confirm they persisted. This is the highest-severity check on the list.
2. **Ultrasonic, the legitimate case.** Reduce the hold count from e.g. 5 to 4. Answers for hold 5
   *should* clear (intended). Confirm the surveyor is not left with orphaned invisible answers, and
   note whether the loss is signposted — it happens across every test round at once.
3. **Fuel Transfer, the unit.** Open a completed job with a variance figure. It must still read
   `<n> USG: <pct>%`, byte-identical to before. Download the PDF and check the same string there —
   the PDF is the riskier path.
4. **Fuel Transfer, the numbering.** Open the template in the builder, edit one label, save. The
   `C1A`..`C1D` numbers must survive. Then add a new field and confirm the item-number box appears
   and can be typed into.
5. **Ultrasonic / OVID / Borescoping, the numbering.** These are `manual_numbering = false`. Add a
   field mid-section, delete one, drag one. Numbering must still auto-run `1..n` with headings and
   dividers skipped — exactly as before.
6. **Borescoping repeatable entries.** Add several entries, put a photo on only one, reorder them,
   reload. All entries and the photo must survive on the right entry.
7. **Offline.** Edit a checklist offline, reconnect, sync. Confirm no spurious "changed on the
   server" conflict, and that cleared answers propagate rather than reappearing.
8. **Locked jobs.** Confirm a closed (mig 117) or paid (mig 134) job still refuses surveyor edits and
   that no clearing fires on it.

**New template — Brine Transfer:**

9. Activate it, create a Brine Transfer job. Confirm the job gets a report number and that overtime
   and KM logging are available.
10. **Numbering:** items read `1..33` **continuously across all five phases** with `1A`, `4A`, `6A`,
    `6B`, `20A`, `21A`, `24A`, `25A`, `30A`, `32A` in place — *not* restarting at 1 per phase.
    Then open it in the builder, save without editing, and re-check.
11. **Conditionals, one by one.** `1A` iff `1`=Yes · `4A` iff `4`=Yes · `6A` iff `6`=Yes ·
    `6B` iff (`6`=Yes **and** `6A`=No) · `20A` iff `20`=Yes · `21A` iff `21`=Yes · `24A` iff `24`=Yes ·
    `25A` iff `25`=Yes · `30A` iff `30`=Yes · `32A` iff `32`=Yes.
12. **Item 22 appears** when any of `20A`/`21A`/`24A`/`25A` is No — including `24A`/`25A`, which sit
    in a *later* section than item 22.
13. **Item 22 clears (the Change C fix).** Answer `20`=Yes, `20A`=No so item 22 appears and is
    answered. Now correct `20` to No. Item 22 must **disappear**, and must **not** appear in the PDF.
14. **Reconciliation.** Ship 49500, Shore 50000 → Difference **−500 BBLS**, % Variance
    **`-500 BBLS: -1.00%` in amber**. Then check the bands: <1% green, 1–2% amber, ≥2% red, on the
    absolute value, for both a positive and a negative variance. Confirm identical output in the PDF.
15. **Hourly Shore Line Inspection.** Submit a job with **zero** entries — it must not block. Then
    add three entries, reorder, reload.
16. **Loading/Discharging** defaults sensibly with Loading first and cannot be left blank.
17. **Transcription accuracy.** Compare all 33 items and the sub-items word-for-word against the
    source form. Report any wording drift, missing item, or wrong answer type.

### Phase 3 — Adversarial pass

Take every PASS from Phase 2 and try to break it. Prioritise:
- Can you find **any** path where `clearHiddenAnswers` runs while values are not fully hydrated
  (draft restore, offline hydration, pending-create, sync)? That would be catastrophic data loss.
- Can a conditional inside a **repeatable** section clear an entry that is visible on screen?
  (Conditions there evaluate against instance 0 only.)
- `clearHiddenAnswers` sweeps only the scalar `values` map. Hidden `multiple_choice` / `video_link`
  (`arrayValues`), `signature` and `photo` answers still persist. Does that matter on any real
  template?
- Does anything still write `item_number` without honouring `manual_numbering`?

---

## 5. Known limits — do not report these as new findings

- **`checkConditionalLogic` is flat.** One top-level `and`/`or`, no nested groups. A descendant must
  repeat its full ancestor chain in its own conditions.
- **Conditionals inside repeatable sections read instance 0 only.** Brine's repeatable section is
  deliberately conditional-free and required-free because of this.
- **A repeatable section always resolves to at least one entry** (`resolveEntryOrder` returns `[0]`),
  so a required field inside one blocks submission when there are no entries.
- **`template_fields.default_value` is dead** — populated by mig 072, read by nothing. Implementing
  it was considered and deliberately rejected as too wide a blast radius.
- **The builder cannot set a `unit` on a calculated field** — Brine's BBLS had to be set in SQL.
- **Stale hidden answers already in the database pre-date this change.** Change C stops new ones; it
  does not retroactively clean old ones. Report the count, propose a cleanup, change nothing.

---

## 6. Deliverable

1. **Bottom line** — one paragraph: is any existing checklist broken, and is the Brine template
   correct and safe to use on a real loadout?
2. **Failures** — anything that FAILED, with reproduction steps and the minimal fix.
3. **Not tested** — be explicit about what you could not verify and why. An honest gap is worth more
   than a guessed pass.
4. **Brine transcription report** — item-by-item against the source form.
5. **Data findings** — the stale-hidden-answer counts, any wrong stored item numbers on the fuel
   templates, any non-USG/BBLS calculated unit.
6. **Owner action list** — short, prioritised, marked MUST or optional.

**Change nothing without flagging it first.** The owner's standing preference on audits is: triage
and get approval before fixing. Read-only investigation is always fine; writes to the database or
the working tree are not, until the findings have been agreed.
