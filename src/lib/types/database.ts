export type UserRole = 'admin' | 'surveyor' | 'client' | 'office'

/**
 * Known office permission keys (seeded in migration 025's
 * office_permission_catalog). The catalog is the source of truth at runtime —
 * this union is a convenience for type-safe checks against the well-known keys.
 * New keys can be added to the catalog without breaking this type.
 */
export type OfficePermissionKey =
  | 'jobs.monitor.view'
  | 'jobs.detail.view'
  | 'clients.view'
  | 'invoicing.view'
  | 'invoicing.manage'
  | 'personal_docs.view'
  | 'personal_docs.expiry.notify'
  | 'calendar.view'
export type TemplateStatus = 'draft' | 'active' | 'archived'
export type FieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'dropdown'
  | 'yes_no'
  | 'yes_no_na'
  | 'multiple_choice'
  | 'textarea'
  | 'calculated'
  | 'photo'
  | 'signature'
  | 'heading'
  | 'divider'
export type JobStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'completed'
  | 'client_visible'
  | 'archived'

export interface UiPrefs {
  /** Ordered list of nav item hrefs for this user's sidebar. */
  nav_order?: string[]
  /** Ordered list of dashboard tile keys the user has chosen to show. */
  dashboard_tiles?: string[]
}

export interface Profile {
  id: string
  email: string
  full_name: string
  role: UserRole
  phone: string | null
  is_active: boolean
  is_super_admin: boolean
  /** Optional cosmetic job title shown in place of the role (e.g. "Super-Cargo").
   *  Grants no permissions — authorization is driven by `role` only. */
  display_title?: string | null
  ui_prefs?: UiPrefs | null
  // Employee / pass fields (self-editable by the owner; admins edit anyone).
  vehicle_number?: string | null
  drivers_permit_number?: string | null
  id_card_number?: string | null
  passport_number?: string | null
  employee_number?: string | null
  created_at: string
  updated_at: string
}

/** A surveyor's own credential document (port pass, licence, passport, COC…). */
export interface PersonalDocument {
  id: string
  profile_id: string
  doc_name: string
  doc_type: string | null
  issue_date: string | null
  expiry_date: string | null
  storage_path: string | null
  content_type: string | null
  size_bytes: number | null
  notes: string | null
  reminder_lead_days: number
  last_reminded_at: string | null
  uploaded_by: string | null
  // Structured-credential fields (migration 036). credential_key NULL = a
  // free-form "other" document; otherwise a known credential carrying its
  // number/expiry/file in one row.
  credential_key: CredentialKey | null
  doc_number: string | null
  insurance_company: string | null
  insurance_type: string | null
  coc_stage: 'receipt' | 'full' | null
  created_at: string
  updated_at: string
}

export type CredentialKey = 'drivers_permit' | 'id_card' | 'passport' | 'insurance' | 'coc'

/** Internal messaging (migration 037). One messages row fans out to N
 *  message_recipients rows (one per recipient). */
export interface Message {
  id: string
  sender_id: string | null
  subject: string
  body: string
  parent_id: string | null
  created_at: string
}
export interface MessageRecipient {
  id: string
  message_id: string
  recipient_id: string
  read_at: string | null
  archived_at: string | null
  created_at: string
}

export type CalendarEventType = 'leave' | 'general'
export type CalendarVisibility = 'private' | 'everyone' | 'roles' | 'users'
export type CalendarStatus = 'pending' | 'approved' | 'rejected'

/** Shared calendar event (migration 038). Leave = owner+admins only; general
 *  events follow `visibility`. Jobs are NOT stored here (read via get_calendar_jobs). */
export interface CalendarEvent {
  id: string
  event_type: CalendarEventType
  title: string
  description: string | null
  start_date: string
  end_date: string
  owner_id: string | null
  created_by: string | null
  status: CalendarStatus
  visibility: CalendarVisibility
  visible_roles: UserRole[]
  visible_user_ids: string[]
  color: string | null
  reviewer_id: string | null
  review_comment: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

/** A job as surfaced on the calendar (safe scheduling fields only). */
export interface CalendarJob {
  id: string
  title: string
  job_number: string | null
  status: string
  scheduled_date: string
  vessel_name: string | null
  surveyor_name: string | null
  client_name: string | null
}

export interface Client {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  notes: string | null
  logo_path: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ClientUser {
  id: string
  profile_id: string
  client_id: string
  created_at: string
}

/** A permission key office staff can be granted (migration 025). */
export interface OfficePermissionCatalogRow {
  key: string
  label: string
  description: string | null
  category: string
  created_at: string
}

/** Per-user grant of an office permission key (migration 025). */
export interface OfficeUserPermission {
  profile_id: string
  permission_key: string
  allowed: boolean
  updated_by: string | null
  updated_at: string
}

export interface ConditionalLogic {
  operator: 'and' | 'or'
  conditions: Array<{
    field_id: string
    operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty'
    value: string
  }>
}

export interface FieldOption {
  value: string
  label: string
  color?: 'green' | 'red' | 'gray' | 'amber'
  /**
   * For dynamic {field} labels: when this option is selected, resolve the
   * token to the live value of the field with this id instead of the option
   * label. Used for "Other" choices that defer to a free-text field.
   * Falls back to the option label when that field is empty.
   */
  useFieldId?: string
}

export interface FieldValidation {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  regex?: string
  // Calculated field display options
  display_as?: 'number' | 'percentage'
  thresholds?: Array<{ max?: number; color: 'green' | 'amber' | 'red' }>
}

export interface ChecklistTemplate {
  id: string
  name: string
  description: string | null
  version: number
  status: TemplateStatus
  allow_surveyor_start: boolean
  created_by: string
  duplicated_from: string | null
  archived_by: string | null
  archived_at: string | null
  restored_by: string | null
  restored_at: string | null
  created_at: string
  updated_at: string
}

export interface TemplateSection {
  id: string
  template_id: string
  title: string
  description: string | null
  order_index: number
  conditional_logic: ConditionalLogic | null
  created_at: string
  updated_at: string
}

export interface TemplateField {
  id: string
  template_id: string
  section_id: string
  label: string
  field_type: FieldType
  order_index: number
  is_required: boolean
  options: FieldOption[] | null
  validation: FieldValidation | null
  calculation_formula: string | null
  conditional_logic: ConditionalLogic | null
  help_text: string | null
  unit: string | null
  item_number: string | null
  with_remarks: boolean
  created_at: string
  updated_at: string
}

/** Ops workflow lifecycle (separate from the checklist `status`). */
export type WorkflowStatus =
  | 'new' | 'assigned' | 'in_progress' | 'report_ready' | 'approved'
  | 'invoiced' | 'sent' | 'paid' | 'closed'

export interface Job {
  id: string
  job_number: string | null
  title: string
  template_id: string | null
  client_id: string | null
  assigned_to: string | null
  vessel_name: string | null
  surveyor_name: string | null
  status: JobStatus
  created_by: string
  scheduled_date: string | null
  started_at: string | null
  submitted_at: string | null
  completed_at: string | null
  internal_notes: string | null
  pdf_storage_path: string | null
  // Job tracker (migration 042)
  job_type: string | null
  report_number: string | null
  workflow_status: WorkflowStatus
  report_approved_at: string | null
  report_approved_by: string | null
  paid_at: string | null
  closed_at: string | null
  closed_by: string | null
  created_at: string
  updated_at: string
}

export interface JobType { id: string; name: string; is_active: boolean; created_at: string }

export type Currency = 'USD' | 'TTD' | 'EUR' | 'GBP'

export interface JobSurveyor {
  id: string; job_id: string; surveyor_id: string
  created_by: string | null; created_at: string
  // Labour ledger (migration 043)
  regular_hours: number; overtime_hours: number
  pay_rate: number | null; overtime_rate: number | null; pay_currency: Currency
  regular_pay: number; overtime_pay: number
}

export interface ClientRate {
  id: string; client_id: string; job_type: string | null
  rate_type: 'fixed' | 'hourly' | 'per_unit'; rate: number
  unit_label: string | null; currency: Currency; is_active: boolean; created_at: string
}

export interface Invoice {
  id: string; job_id: string | null; invoice_number: string | null; client_id: string | null
  currency: Currency; status: 'draft' | 'sent' | 'paid' | 'overdue' | 'void'
  issue_date: string; due_date: string | null
  subtotal: number; tax_total: number; total: number; notes: string | null
  // Document fields for the printable PDF (migration 044)
  description: string | null; reference: string | null; attention: string | null; bank_details: string | null
  created_by: string | null; sent_at: string | null; paid_at: string | null
  // Follow-up reminders (migration 045)
  last_reminded_at: string | null
  created_at: string; updated_at: string
}
export interface InvoiceLineItem { id: string; invoice_id: string; description: string; qty: number; unit_price: number; amount: number; sort: number }
export interface InvoiceTax { id: string; invoice_id: string; name: string; rate: number; amount: number }
export interface AppSettings { id: boolean; default_tax_name: string; default_tax_rate: number; overdue_days: number; bank_details_default: string | null }

export type JobAttachmentKind = 'preliminary' | 'final' | 'vos' | 'time_page' | 'other'
export interface JobAttachment {
  id: string; job_id: string; kind: JobAttachmentKind
  doc_name: string | null; storage_path: string | null
  content_type: string | null; size_bytes: number | null
  uploaded_by: string | null; created_at: string
}

export interface ActivityLogRow {
  id: string; entity: string; entity_id: string | null; action: string
  actor_id: string | null; meta: Record<string, unknown> | null; created_at: string
}

export interface JobFieldValue {
  id: string
  job_id: string
  field_id: string
  value: string | null
  value_array: string[] | null
  created_at: string
  updated_at: string
}

export interface JobPhoto {
  id: string
  job_id: string
  field_id: string | null
  storage_path: string
  filename: string
  caption: string | null
  include_in_pdf: boolean
  uploaded_by: string
  created_at: string
  // Offline capture metadata (migration 023)
  client_local_id: string | null
  captured_at: string | null
  gps_lat: number | null
  gps_lng: number | null
  gps_accuracy_m: number | null
  uploaded_offline: boolean
}

export interface JobSignature {
  id: string
  job_id: string
  field_id: string
  signature_data: string
  signed_by_name: string | null
  signed_at: string
}

export interface ClientJobPermission {
  id: string
  client_id: string
  job_id: string
  can_view_status: boolean
  can_view_pdf: boolean
  can_view_checklist_details: boolean
  created_at: string
  updated_at: string
}

export interface SurveyorName {
  id: string
  name: string
  is_active: boolean
  approved_by: string | null
  approved_at: string | null
  created_at: string
  /** Optional link to a real login profile. When set, jobs using this name are assigned to this profile. */
  profile_id: string | null
}

export interface SurveyorNameRequest {
  id: string
  requested_name: string
  requested_by: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export interface ClientRequest {
  id: string
  requested_name: string
  requested_by: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

// Extended types with joins
export interface TemplateWithSections extends ChecklistTemplate {
  sections: TemplateSectionWithFields[]
  creator?: Profile
}

export interface TemplateSectionWithFields extends TemplateSection {
  fields: TemplateField[]
}

export interface JobWithDetails extends Job {
  template?: ChecklistTemplate
  client?: Client
  assignee?: Profile
  creator?: Profile
  field_values?: JobFieldValue[]
  signatures?: JobSignature[]
  photos?: JobPhoto[]
  client_permissions?: ClientJobPermission[]
}
