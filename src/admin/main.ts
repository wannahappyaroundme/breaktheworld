import './style.css'

const root = document.getElementById('admin-app')

if (!root) throw new Error('Admin app root is missing')

const loading = document.createElement('section')
loading.className = 'admin-loading'
loading.setAttribute('aria-labelledby', 'admin-loading-title')
loading.setAttribute('aria-describedby', 'admin-loading-copy')
loading.setAttribute('aria-busy', 'true')

const mark = document.createElement('div')
mark.className = 'admin-loading__mark'
mark.setAttribute('aria-hidden', 'true')
mark.textContent = '💥'

const title = document.createElement('h1')
title.id = 'admin-loading-title'
title.textContent = '세상 부수기 운영자'

const copy = document.createElement('p')
copy.id = 'admin-loading-copy'
copy.textContent = '운영자 설정을 불러오는 중이에요.'

const progress = document.createElement('div')
progress.className = 'admin-loading__progress'
progress.setAttribute('aria-hidden', 'true')
progress.append(document.createElement('span'))

loading.append(mark, title, copy, progress)
root.replaceChildren(loading)
