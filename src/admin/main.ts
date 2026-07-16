import './style.css'

import { AdminApi } from './api'
import { AdminView } from './view'
import { getSupabase } from '../services/supabase'

const root = document.getElementById('admin-app')

if (!root) throw new Error('Admin app root is missing')

const supabase = getSupabase()

if (!supabase) {
  const card = document.createElement('section')
  card.className = 'admin-auth-card'
  const title = document.createElement('h1')
  title.textContent = '연결 설정을 확인해 주세요.'
  const copy = document.createElement('p')
  copy.className = 'admin-lead'
  copy.textContent = '연결 정보를 입력한 뒤 화면을 새로 열면 운영자 기능을 사용할 수 있어요.'
  card.append(title, copy)
  root.replaceChildren(card)
} else {
  const api = new AdminApi(supabase)
  const view = new AdminView(root, api)
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') view.renderSessionExpired()
  })
  void view.start()
}
