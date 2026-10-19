import { reactive, readonly } from 'vue'

export function useUploadProgress() {
  const state = reactive({ phase: 'idle', fileName: '', loaded: 0, total: 0, index: 1, count: 1 })
  return {
    progress: readonly(state),
    clear() { Object.assign(state, { phase: 'idle', fileName: '', loaded: 0, total: 0, index: 1, count: 1 }) },
    prepare(file, index = 1, count = 1) {
      Object.assign(state, { phase: 'preparing', fileName: file.name, loaded: 0, total: file.size, index, count })
    },
    update({ phase, loaded, total }) { Object.assign(state, { phase, loaded, total }) },
    complete() { state.phase = 'complete'; state.loaded = state.total },
    fail() { state.phase = 'error' },
  }
}
