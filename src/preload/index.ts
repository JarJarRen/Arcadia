import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ArcadiaApi } from '@shared/ipc'

const api: ArcadiaApi = {
  getGames: () => ipcRenderer.invoke(IPC.libraryGet),
  sync: () => ipcRenderer.invoke(IPC.librarySync),
  launch: (gameId) => ipcRenderer.invoke(IPC.gameLaunch, gameId),
  install: (gameId) => ipcRenderer.invoke(IPC.gameInstall, gameId),
  cancelInstall: () => ipcRenderer.invoke(IPC.gameInstallCancel),
  setFavorite: (mergeKey, value) => ipcRenderer.invoke(IPC.gameSetFavorite, mergeKey, value),
  setPreferredStore: (mergeKey, gameId) =>
    ipcRenderer.invoke(IPC.mergeSetPreferred, mergeKey, gameId),
  setSplit: (mergeKey, split) => ipcRenderer.invoke(IPC.mergeSetSplit, mergeKey, split),
  openFolder: (mergeKey) => ipcRenderer.invoke(IPC.gameOpenFolder, mergeKey),
  searchApps: (query) => ipcRenderer.invoke(IPC.metadataSearch, query),
  setMatch: (mergeKey, steamAppId) =>
    ipcRenderer.invoke(IPC.metadataSetMatch, mergeKey, steamAppId),
  setLanguage: (language) => ipcRenderer.invoke(IPC.settingsSetLanguage, language),
  getEnvConfig: () => ipcRenderer.invoke(IPC.envConfigGet),
  saveEnvConfig: (values) => ipcRenderer.invoke(IPC.envConfigSave, values),
  addManualGame: (game) => ipcRenderer.invoke(IPC.libraryAddManual, game),
  removeManualGame: (gameId) => ipcRenderer.invoke(IPC.libraryRemoveManual, gameId),
  reportBrokenArtwork: (mergeKey, kind) => ipcRenderer.invoke(IPC.artworkBroken, mergeKey, kind),
  onLibraryChanged: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.libraryChanged, listener)
    // Return the cleanup function, otherwise listeners pile up on every
    // React remount.
    return () => ipcRenderer.removeListener(IPC.libraryChanged, listener)
  },
  onNavigateBack: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.navigateBack, listener)
    return () => ipcRenderer.removeListener(IPC.navigateBack, listener)
  },
  onNavigateForward: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.navigateForward, listener)
    return () => ipcRenderer.removeListener(IPC.navigateForward, listener)
  }
}

contextBridge.exposeInMainWorld('arcadia', api)
