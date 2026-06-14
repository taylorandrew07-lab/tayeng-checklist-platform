import CargoListView from '@/components/cargo/CargoListView'
import CargoOperationsView from '@/components/cargo/CargoOperationsView'

export default function AdminCargoListPage() {
  return (
    <div className="space-y-10">
      {/* Company-wide, cloud-backed picture (the real operational view). */}
      <CargoOperationsView />
      {/* This admin's own offline voyages, honestly scoped to this device. */}
      <CargoListView embedded />
    </div>
  )
}
