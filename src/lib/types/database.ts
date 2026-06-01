export type UserRole = 'admin' | 'surveyor' | 'client'
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

export interface Profile {
  id: string
  email: string
  full_name: string
  role: UserRole
  phone: string | null
  is_active: boolean
  is_super_admin: boolean
  created_at: string
  updated_at: string
}

export interface Client {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  notes: string | null
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
}

export interface FieldValidation {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  regex?: string
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
  placeholder: string | null
  help_text: string | null
  unit: string | null
  default_value: string | null
  item_number: string | null
  with_remarks: boolean
  created_at: string
  updated_at: string
}

export interface Job {
  id: string
  job_number: string | null
  title: string
  template_id: string
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
  created_at: string
  updated_at: string
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
