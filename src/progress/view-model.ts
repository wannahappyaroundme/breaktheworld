import {
  ACHIEVEMENTS,
  ACHIEVEMENT_CATALOG_PUBLISHED_AT,
  achievementProgress,
  availableFrameIds,
  availableThemeIds,
  levelProgress,
  totalAchievementXp,
  type AchievementCategory,
  type AchievementId,
  type AchievementTier,
  type QuestCatalogSnapshot,
} from './catalog'
import type { ProfileFrameId, ProgressStateV1, RecordBookThemeId } from './types'

export type HubTab = 'home' | 'achievements' | 'cosmetics' | 'settings'
export type AchievementStatusFilter = 'all' | 'active' | 'complete'
export type AchievementCategoryFilter = 'all' | AchievementCategory

export interface AchievementCardView {
  id: AchievementId
  name: string
  description: string
  icon: string
  tier: AchievementTier
  tierLabel: '쉬움' | '보통' | '어려움' | '달인'
  category: AchievementCategory
  categoryLabel: '파괴 기록' | '연속·충전' | '무기·캐릭터' | '세계·장기'
  xp: number
  progress: number
  target: number
  ratio: number
  progressText: string
  complete: boolean
  seen: boolean
  titleReward: boolean
}

interface CosmeticChoice<Id extends string> {
  id: Id
  name: string
  selected: boolean
  unlocked: boolean
  requirement: string
}

interface SkinGroupView {
  id: 'cinnamoroll' | 'ditto'
  name: string
  choices: Array<{
    id: 'default' | 'classic'
    label: string
    selected: boolean
  }>
}

export interface RecordBookView {
  summary: {
    level: number
    xp: number
    currentLevelXp: number
    nextLevelXp: number
    levelRatio: number
    completed: number
    total: number
    completionRatio: number
    completionText: string
    nearest: AchievementCardView[]
    recent: { count: number; xp: number; copy: string } | null
  }
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
    items: AchievementCardView[]
    categories: Array<{ id: AchievementCategoryFilter; label: string }>
    statuses: Array<{ id: AchievementStatusFilter; label: string }>
  }
  cosmetics: {
    heading: string
    titles: Array<CosmeticChoice<AchievementId>>
    frames: Array<CosmeticChoice<ProfileFrameId>>
    themes: Array<CosmeticChoice<RecordBookThemeId>>
    skins: SkinGroupView[]
  }
  stats: {
    heading: string
    items: Array<{ label: string; value: string }>
  }
  profile: {
    selectedTitle: string | null
    frameId: ProfileFrameId
    recordBookThemeId: RecordBookThemeId
  }
}

const TIER_LABELS: Record<AchievementTier, AchievementCardView['tierLabel']> = {
  easy: '쉬움',
  normal: '보통',
  hard: '어려움',
  master: '달인',
}

const CATEGORY_LABELS: Record<AchievementCategory, AchievementCardView['categoryLabel']> = {
  destruction: '파괴 기록',
  skill: '연속·충전',
  exploration: '무기·캐릭터',
  journey: '세계·장기',
}

const FRAME_REWARDS: ReadonlyArray<{
  id: ProfileFrameId
  name: string
  level: number
}> = [
  { id: 'default', name: '기본 테두리', level: 1 },
  { id: 'first_crack', name: '첫 균열', level: 5 },
  { id: 'electric_night', name: '번쩍이는 밤', level: 10 },
  { id: 'coral_burst', name: '폭발하는 노을', level: 15 },
  { id: 'legend_crown', name: '전설의 왕관', level: 20 },
]

const THEME_REWARDS: ReadonlyArray<{
  id: RecordBookThemeId
  name: string
  level: number
}> = [
  { id: 'default', name: '한밤의 종이', level: 1 },
  { id: 'electric_night', name: '번쩍이는 밤', level: 10 },
  { id: 'coral_burst', name: '폭발하는 노을', level: 15 },
  { id: 'legend_crown', name: '전설의 왕관', level: 20 },
]

function skinChoices(selected: string | undefined): SkinGroupView['choices'] {
  const selectedId = selected === 'classic' ? 'classic' : 'default'
  return [
    { id: 'default', label: '기본', selected: selectedId === 'default' },
    { id: 'classic', label: '클래식', selected: selectedId === 'classic' },
  ]
}

function percentage(ratio: number): number {
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100)
}

function achievementCard(
  achievement: (typeof ACHIEVEMENTS)[number],
  state: ProgressStateV1
): AchievementCardView {
  const unlocked = state.achievements[achievement.id]
  const progress = achievementProgress(achievement, state)
  const ratio = Math.min(progress / achievement.target, 1)
  return {
    id: achievement.id,
    name: achievement.name,
    description: achievement.description,
    icon: achievement.icon,
    tier: achievement.tier,
    tierLabel: TIER_LABELS[achievement.tier],
    category: achievement.category,
    categoryLabel: CATEGORY_LABELS[achievement.category],
    xp: achievement.xp,
    progress,
    target: achievement.target,
    ratio,
    progressText: `${progress} / ${achievement.target}, ${percentage(ratio)}%`,
    complete: unlocked !== undefined,
    seen: unlocked?.seen ?? false,
    titleReward: achievement.titleReward,
  }
}

function levelCosmetic<Id extends ProfileFrameId | RecordBookThemeId>(
  reward: { id: Id; name: string; level: number },
  selected: Id,
  available: readonly Id[]
): CosmeticChoice<Id> {
  const unlocked = available.includes(reward.id)
  const subjectParticle = reward.level % 10 === 0 ? '이' : '가'
  return {
    id: reward.id,
    name: reward.name,
    selected: unlocked && selected === reward.id,
    unlocked,
    requirement: unlocked
      ? '지금 고를 수 있어요'
      : `레벨 ${reward.level}${subjectParticle} 되면 고를 수 있어요`,
  }
}

/** Maps persisted progress to plain, ordered display data without environment reads. */
export function makeRecordBookView(
  state: ProgressStateV1,
  catalog: QuestCatalogSnapshot
): RecordBookView {
  const quest = catalog.quests.find((candidate) => candidate.id === state.daily.questId)
  const dailyProgress = Math.min(state.daily.progress, state.daily.target)
  const cards = ACHIEVEMENTS.map((achievement) => achievementCard(achievement, state))
  const xp = totalAchievementXp(state)
  const progression = levelProgress(xp)
  const completed = cards.filter(({ complete }) => complete).length
  const selectedAchievement = ACHIEVEMENTS.find(
    (achievement) => achievement.name === state.profile.selectedTitle
  )
  const selectedTitle = selectedAchievement
    && state.achievements[selectedAchievement.id] !== undefined
    ? selectedAchievement.name
    : null
  const frames = availableFrameIds(progression.level)
  const themes = availableThemeIds(progression.level)
  const selectedFrame = frames.includes(state.profile.frameId)
    ? state.profile.frameId
    : 'default'
  const selectedTheme = themes.includes(state.profile.recordBookThemeId)
    ? state.profile.recordBookThemeId
    : 'default'
  const recentItems = ACHIEVEMENTS.filter((achievement) => {
    const unlock = state.achievements[achievement.id]
    return unlock?.unlockedAt === ACHIEVEMENT_CATALOG_PUBLISHED_AT && !unlock.seen
  })
  const recentXp = recentItems.reduce((sum, achievement) => sum + achievement.xp, 0)
  const nearest = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !card.complete)
    .sort((left, right) => (
      right.card.ratio - left.card.ratio
      || (left.card.target - left.card.progress) - (right.card.target - right.card.progress)
      || left.index - right.index
    ))
    .slice(0, 3)
    .map(({ card }) => card)

  return {
    summary: {
      level: progression.level,
      xp: progression.xp,
      currentLevelXp: progression.current,
      nextLevelXp: progression.next,
      levelRatio: progression.progress,
      completed,
      total: cards.length,
      completionRatio: cards.length === 0 ? 0 : completed / cards.length,
      completionText: `${completed} / ${cards.length}, ${percentage(completed / cards.length)}%`,
      nearest,
      recent: recentItems.length === 0
        ? null
        : {
            count: recentItems.length,
            xp: recentXp,
            copy: `지난 기록으로 업적 ${recentItems.length}개를 찾았어요, 경험치 +${recentXp}`,
          },
    },
    daily: {
      heading: '오늘의 도전',
      copy: state.daily.quest?.copy ?? quest?.copy ?? '오늘의 도전을 골라보세요',
      progress: dailyProgress,
      target: state.daily.target,
      progressText: `${dailyProgress} / ${state.daily.target}`,
      complete: state.daily.completedAt !== null && state.daily.stampAwarded,
    },
    achievements: {
      heading: '업적',
      items: cards,
      categories: [
        { id: 'all', label: '전체 분야' },
        { id: 'destruction', label: '파괴 기록' },
        { id: 'skill', label: '연속·충전' },
        { id: 'exploration', label: '무기·캐릭터' },
        { id: 'journey', label: '세계·장기' },
      ],
      statuses: [
        { id: 'all', label: '전체' },
        { id: 'active', label: '진행 중' },
        { id: 'complete', label: '완료' },
      ],
    },
    cosmetics: {
      heading: '꾸미기',
      titles: ACHIEVEMENTS.filter(({ titleReward }) => titleReward).map((achievement) => {
        const unlocked = state.achievements[achievement.id] !== undefined
        return {
          id: achievement.id,
          name: achievement.name,
          selected: unlocked && selectedTitle === achievement.name,
          unlocked,
          requirement: unlocked
            ? '지금 고를 수 있어요'
            : `'${achievement.name}' 업적을 완료하면 고를 수 있어요`,
        }
      }),
      frames: FRAME_REWARDS.map((reward) => levelCosmetic(reward, selectedFrame, frames)),
      themes: THEME_REWARDS.map((reward) => levelCosmetic(reward, selectedTheme, themes)),
      skins: [
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
    profile: {
      selectedTitle,
      frameId: selectedFrame,
      recordBookThemeId: selectedTheme,
    },
  }
}
