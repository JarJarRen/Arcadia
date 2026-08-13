import { findValue, readRegistryTree, type ExecFn } from '@main/platform/registry'

/**
 * Every installed package, with its display name and its folder.
 *
 * Under HKCU: the repository records what is installed *for this user*,
 * which is what a library should list. On the development machine it holds
 * 198 entries, each with a usable `PackageID` and `PackageRootFolder`.
 */
const PACKAGES_KEY =
  'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows' +
  '\\CurrentVersion\\AppModel\\Repository\\Packages'

export interface InstalledPackage {
  packageFamilyName: string
  displayName?: string
  installPath?: string
}

/**
 * `Name_Version_Arch__PublisherId` → `Name_PublisherId`.
 *
 * The family name is what survives an update; the full name carries the
 * version and would change under every game on every patch. Splitting on
 * `_` is safe because a package *name* may not contain one — MSIX allows
 * only alphanumerics, periods and dashes there.
 */
export function familyNameFromFullName(fullName: string): string | undefined {
  const parts = fullName.split('_')
  if (parts.length < 2) return undefined
  const name = parts[0]
  const publisherId = parts[parts.length - 1]
  if (name === undefined || name === '') return undefined
  if (publisherId === undefined || publisherId === '') return undefined
  return `${name}_${publisherId}`
}

/**
 * The display name, unless it is only a promise of one.
 *
 * Windows stores `@{PackageFullName?ms-resource://…}` for packages whose
 * name lives in a resource file and resolves it when it draws the Start
 * menu. Read straight from the registry it is not a name — Paint stores
 * exactly this — and showing it would be worse than showing nothing.
 */
export function usableDisplayName(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  if (value.startsWith('@{')) return undefined
  return value
}

export async function readInstalledPackages(
  exec?: ExecFn
): Promise<Map<string, InstalledPackage>> {
  const blocks = await readRegistryTree(PACKAGES_KEY, exec)

  const packages = new Map<string, InstalledPackage>()
  for (const values of blocks) {
    // The tree also yields each package's own subkeys — `\App` and below —
    // which carry no PackageID. Those are not packages.
    const fullName = findValue(values, 'PackageID')
    if (fullName === undefined) continue

    const packageFamilyName = familyNameFromFullName(fullName)
    if (packageFamilyName === undefined) continue

    const displayName = usableDisplayName(findValue(values, 'DisplayName'))
    const root = findValue(values, 'PackageRootFolder')

    packages.set(packageFamilyName, {
      packageFamilyName,
      ...(displayName === undefined ? {} : { displayName }),
      ...(root === undefined || root === '' ? {} : { installPath: root })
    })
  }
  return packages
}
