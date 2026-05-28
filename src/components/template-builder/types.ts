import type { FieldType, FieldOption, FieldValidation, ConditionalLogic } from '@/lib/types/database'

export interface BuilderField {
  id: string
  label: string
  field_type: FieldType
  order_index: number
  is_required: boolean
  options: FieldOption[]
  validation: FieldValidation
  calculation_formula: string
  conditional_logic: ConditionalLogic | null
  placeholder: string
  help_text: string
  unit: string
  default_value: string
  item_number: string
  with_remarks: boolean
}

export interface BuilderSection {
  id: string
  title: string
  description: string
  order_index: number
  conditional_logic: ConditionalLogic | null
  fields: BuilderField[]
}

export const FIELD_TYPE_OPTIONS: { value: FieldType; label: string; group: string }[] = [
  { value: 'heading', label: 'Section Heading', group: 'Layout' },
  { value: 'divider', label: 'Divider', group: 'Layout' },
  { value: 'text', label: 'Text', group: 'Input' },
  { value: 'number', label: 'Number', group: 'Input' },
  { value: 'textarea', label: 'Long Text / Remarks', group: 'Input' },
  { value: 'date', label: 'Date', group: 'Input' },
  { value: 'time', label: 'Time', group: 'Input' },
  { value: 'dropdown', label: 'Dropdown', group: 'Choice' },
  { value: 'yes_no', label: 'Yes / No', group: 'Choice' },
  { value: 'yes_no_na', label: 'Yes / No / N/A', group: 'Choice' },
  { value: 'multiple_choice', label: 'Multiple Choice', group: 'Choice' },
  { value: 'calculated', label: 'Calculated Field', group: 'Special' },
  { value: 'photo', label: 'Photo Upload', group: 'Special' },
  { value: 'signature', label: 'Signature', group: 'Special' },
]

export function createBlankField(order_index: number): BuilderField {
  return {
    id: crypto.randomUUID(),
    label: 'New Field',
    field_type: 'text',
    order_index,
    is_required: false,
    options: [],
    validation: {},
    calculation_formula: '',
    conditional_logic: null,
    placeholder: '',
    help_text: '',
    unit: '',
    default_value: '',
    item_number: '',
    with_remarks: false,
  }
}

export function createBlankSection(order_index: number): BuilderSection {
  return {
    id: crypto.randomUUID(),
    title: 'New Section',
    description: '',
    order_index,
    conditional_logic: null,
    fields: [],
  }
}
