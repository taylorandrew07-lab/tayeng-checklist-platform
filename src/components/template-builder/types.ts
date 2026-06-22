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
  help_text: string
  unit: string
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
  { value: 'pass_fail', label: 'Pass / Fail', group: 'Choice' },
  { value: 'multiple_choice', label: 'Multiple Choice', group: 'Choice' },
  { value: 'calculated', label: 'Calculated Field', group: 'Special' },
  { value: 'photo', label: 'Photo Upload', group: 'Special' },
  { value: 'signature', label: 'Signature', group: 'Special' },
]

export function getDefaultYesNoOptions(type: 'yes_no' | 'yes_no_na' | 'pass_fail'): FieldOption[] {
  if (type === 'pass_fail') {
    return [
      { value: 'pass', label: 'Pass', color: 'green' },
      { value: 'fail', label: 'Fail', color: 'red' },
    ]
  }
  const base: FieldOption[] = [
    { value: 'yes', label: 'Yes', color: 'green' },
    { value: 'no', label: 'No', color: 'red' },
  ]
  if (type === 'yes_no_na') {
    return [...base, { value: 'na', label: 'N/A', color: 'gray' }]
  }
  return base
}

export function createBlankField(order_index: number, field_type: BuilderField['field_type'] = 'text'): BuilderField {
  const options: FieldOption[] =
    field_type === 'yes_no' || field_type === 'yes_no_na' || field_type === 'pass_fail'
      ? getDefaultYesNoOptions(field_type)
      : []

  return {
    id: crypto.randomUUID(),
    label: 'New Field',
    field_type,
    order_index,
    is_required: false,
    options,
    validation: {},
    calculation_formula: '',
    conditional_logic: null,
    help_text: '',
    unit: '',
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
