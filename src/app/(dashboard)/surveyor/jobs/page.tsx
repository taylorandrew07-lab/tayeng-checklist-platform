import { redirect } from 'next/navigation'

// Redirect /surveyor/jobs to /surveyor (dashboard shows all jobs)
export default function SurveyorJobsPage() {
  redirect('/surveyor')
}
