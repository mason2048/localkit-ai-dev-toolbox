import { diffLines, diffWordsWithSpace, type Change } from 'diff'

export type DiffMode = 'lines' | 'words'

export function compareText(before: string, after: string, mode: DiffMode): Change[] {
  return mode === 'lines' ? diffLines(before, after) : diffWordsWithSpace(before, after)
}

export function diffSummary(changes: Change[]) {
  return changes.reduce((summary, change) => {
    const count = change.count ?? (change.value.match(/\n/g)?.length || 1)
    if (change.added) summary.added += count
    else if (change.removed) summary.removed += count
    else summary.unchanged += count
    return summary
  }, { added: 0, removed: 0, unchanged: 0 })
}
