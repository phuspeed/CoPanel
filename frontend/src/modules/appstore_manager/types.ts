export type UpdateStatus = 'not_installed' | 'up_to_date' | 'update_available' | 'ahead';

export type StoreNav = 'hot' | 'all' | 'updates' | 'manage';

export type PackageCategory =
  | 'development'
  | 'system'
  | 'web'
  | 'database'
  | 'security'
  | 'other';

export interface Package {
  id: string;
  name: string;
  description: string;
  version: string;
  remote_version?: string;
  icon: string;
  download_url: string;
  installed?: boolean;
  has_update?: boolean;
  local_version?: string;
  update_status?: UpdateStatus;
  is_core?: boolean;
  system_packages?: string[];
  pip_packages?: string[];
  requires_copanel_restart?: boolean;
  changelog_en?: string;
  changelog_vi?: string;
  is_community?: boolean;
}
