import { PLAYER_PRIVACY_VERSION } from '../../supabase/functions/_shared/player-contract'
import type { FeatureFlags } from '../config/feature-flags'

export interface PlayerPrivacyNotice {
  version: typeof PLAYER_PRIVACY_VERSION
  ready: boolean
  title: string
  items: readonly [string, string, string, string, string]
  ageConfirmation: string
}

export function createPlayerPrivacyNotice(input: {
  deletionContact: string
  processingNotice: string
}): PlayerPrivacyNotice {
  const deletionContact = input.deletionContact.trim()
  const processingNotice = input.processingNotice.trim()
  return {
    version: PLAYER_PRIVACY_VERSION,
    ready: deletionContact.length > 0 && processingNotice.length > 0,
    title: '프로필과 기록 저장 안내',
    items: [
      '프로필 ID와 게임 기록, 설정을 저장해요.',
      '이메일, 전화번호, 실명, 생년월일은 받지 않아요.',
      '프로필을 삭제할 때까지 보관해요.',
      processingNotice,
      deletionContact,
    ],
    ageConfirmation: '만 14세 이상이며, 프로필과 기록 저장 안내를 확인했어요.',
  }
}

export function playerSignupEnabled(
  flags: Pick<FeatureFlags, 'player_signup'>,
  notice: Pick<PlayerPrivacyNotice, 'ready'>,
): boolean {
  return flags.player_signup && notice.ready
}

export const PLAYER_PRIVACY_NOTICE = createPlayerPrivacyNotice({
  deletionContact: import.meta.env.VITE_PLAYER_DELETION_CONTACT ?? '',
  processingNotice: import.meta.env.VITE_PLAYER_PROCESSING_NOTICE ?? '',
})
