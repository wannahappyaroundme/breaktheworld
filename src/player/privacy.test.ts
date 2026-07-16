import { describe, expect, it } from 'vitest'

import { PLAYER_PRIVACY_VERSION } from '../../supabase/functions/_shared/player-contract'
import { BUILT_IN_FLAGS } from '../config/feature-flags'
import { createPlayerPrivacyNotice, playerSignupEnabled } from './privacy'

describe('player privacy notice', () => {
  it('uses one versioned notice with the approved public copy', () => {
    const notice = createPlayerPrivacyNotice({
      deletionContact: '프로필을 만든 운영자에게 카카오톡으로 알려 주세요.',
      processingNotice: '기록 저장 위치와 처리 업체를 확인했어요.',
    })

    expect(notice).toMatchObject({ version: PLAYER_PRIVACY_VERSION, ready: true })
    expect(notice.items).toEqual([
      '프로필 ID와 게임 기록, 설정을 저장해요.',
      '이메일, 전화번호, 실명, 생년월일은 받지 않아요.',
      '프로필을 삭제할 때까지 보관해요.',
      '기록 저장 위치와 처리 업체를 확인했어요.',
      '프로필을 만든 운영자에게 카카오톡으로 알려 주세요.',
    ])
  })

  it('fails closed until both deployment notice values are present', () => {
    const incomplete = createPlayerPrivacyNotice({ deletionContact: '', processingNotice: '' })
    const openedFlags = { ...BUILT_IN_FLAGS, player_signup: true }

    expect(incomplete.ready).toBe(false)
    expect(playerSignupEnabled(openedFlags, incomplete)).toBe(false)
    expect(playerSignupEnabled(openedFlags, createPlayerPrivacyNotice({
      deletionContact: '프로필 삭제는 운영자에게 알려 주세요.',
      processingNotice: '기록은 한국 리전에 저장해요.',
    }))).toBe(true)
  })
})
