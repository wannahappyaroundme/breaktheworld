import {
  ACHIEVEMENTS,
  achievementProgress,
  type AchievementId,
  type QuestCatalogSnapshot,
} from './catalog'
import type { ProgressStateV1 } from './types'

export interface RecordBookView {
  daily: {
    heading: string
    copy: string
    progress: number
    target: number
    progressText: string
    complete: boolean
  }
  achievements: {
    heading: string
    items: Array<{
      id: AchievementId
      name: string
      next: string
      progress: number
      target: number
      complete: boolean
      seen: boolean
      selectableTitle: string | null
    }>
  }
  skins: {
    heading: string
    items: Array<{
      id: 'cinnamoroll' | 'ditto'
      name: string
      choices: Array<{
        id: 'default' | 'classic'
        label: string
        selected: boolean
      }>
    }>
  }
  stats: {
    heading: string
    items: Array<{ label: string; value: string }>
  }
  selectedTitle: string | null
}

function skinChoices(selected: string | undefined): Array<{
  id: 'default' | 'classic'
  label: string
  selected: boolean
}> {
  const selectedId = selected === 'classic' ? 'classic' : 'default'
  return [
    { id: 'default', label: '기본', selected: selectedId === 'default' },
    { id: 'classic', label: '클래식', selected: selectedId === 'classic' },
  ]
}

/** Maps persisted progress to plain, ordered display data without environment reads. */
export function makeRecordBookView(
  state: ProgressStateV1,
  catalog: QuestCatalogSnapshot
): RecordBookView {
  const quest = catalog.quests.find((candidate) => candidate.id === state.daily.questId)
  const progress = Math.min(state.daily.progress, state.daily.target)
  const selectedAchievement = ACHIEVEMENTS.find(
    (achievement) => achievement.name === state.profile.selectedTitle
  )
  const selectedTitle = selectedAchievement
    && state.achievements[selectedAchievement.id] !== undefined
    ? selectedAchievement.name
    : null

  return {
    daily: {
      heading: '오늘의 도전',
      copy: quest?.copy ?? '오늘의 도전을 골라보세요',
      progress,
      target: state.daily.target,
      progressText: `${progress} / ${state.daily.target}`,
      complete: state.daily.completedAt !== null && state.daily.stampAwarded,
    },
    achievements: {
      heading: '부순 기록',
      items: ACHIEVEMENTS.map((achievement) => {
        const unlocked = state.achievements[achievement.id]
        return {
          id: achievement.id,
          name: achievement.name,
          next: achievement.next,
          progress: achievementProgress(achievement, state),
          target: achievement.target,
          complete: unlocked !== undefined,
          seen: unlocked?.seen ?? false,
          selectableTitle: unlocked ? achievement.name : null,
        }
      }),
    },
    skins: {
      heading: '캐릭터 모습',
      items: [
        {
          id: 'cinnamoroll',
          name: '시나모롤',
          choices: skinChoices(state.profile.skins.cinnamoroll),
        },
        {
          id: 'ditto',
          name: '메타몽',
          choices: skinChoices(state.profile.skins.ditto),
        },
      ],
    },
    stats: {
      heading: '내 기록',
      items: [
        { label: '최고 연속', value: String(state.lifetime.bestCombo) },
        { label: '누적 파괴', value: String(state.lifetime.totalTargets) },
        { label: '충전 강타', value: String(state.lifetime.chargedFinishers) },
        { label: '사용한 무기', value: `${new Set(state.lifetime.distinctWeaponIds).size}종` },
      ],
    },
    selectedTitle,
  }
}
