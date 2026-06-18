// Route-level loading UI for every dashboard segment (admin/office/surveyor/client/
// inbox/…). Shown during server navigation/data fetches so a slow page renders an
// instant spinner instead of a blank frame.
export default function DashboardLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading&hellip;</p>
      </div>
    </div>
  )
}
