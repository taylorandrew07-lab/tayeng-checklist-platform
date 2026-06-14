'use client'

import Link from 'next/link'
import { Menu } from 'lucide-react'
import GlobalSearch from '@/components/layout/GlobalSearch'
import type { Profile } from '@/lib/types/database'

interface HeaderProps {
  profile: Profile
  title?: string
  onMenuClick: () => void
}

export default function Header({ profile, title, onMenuClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 bg-white border-b border-gray-200 px-4 lg:px-6">
      <button
        onClick={onMenuClick}
        className="lg:hidden -ml-1 rounded-md p-2 text-gray-500 hover:bg-gray-100"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex-1 min-w-0 flex items-center gap-4">
        {title && (
          <h1 className="text-lg font-semibold text-gray-900 truncate flex-shrink-0">{title}</h1>
        )}
        {profile.role !== 'client' && (
          <div className="hidden sm:flex flex-1 min-w-0">
            <GlobalSearch role={profile.role} />
          </div>
        )}
      </div>

      <Link href="/profile" className="flex items-center gap-3 flex-shrink-0 rounded-lg hover:bg-gray-100 px-1.5 py-1 -mr-1.5" title="My profile">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-gray-900 leading-tight">{profile.full_name}</p>
          <p className="text-xs text-gray-500 capitalize">{profile.display_title ?? profile.role}</p>
        </div>
        <div className="w-9 h-9 rounded-full bg-brand-700 flex items-center justify-center text-white font-medium text-sm flex-shrink-0">
          {profile.full_name.charAt(0).toUpperCase()}
        </div>
      </Link>
    </header>
  )
}
