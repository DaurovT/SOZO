#!/usr/bin/env bash
#
# Демо-данные с нуля: заявки, роли на точках и фикстура прав B2B.
#
# Зачем отдельный скрипт: POST /v1/app/demo/seed наполняет ТОЛЬКО номер того,
# кто его вызвал (README и HANDOVER говорят «под диспетчером» — это неточность,
# из-за неё заявки ложатся на диспетчера). А номера +99890000080X, на которых
# держится b2b-access-e2e, в коде не заводятся вообще: они жили только в старом
# state.json, которого нет в репозитории. Здесь они создаются заново.
#
#   ./deploy/seed-demo.sh [http://127.0.0.1]
#
set -euo pipefail
ROOT="${1:-http://127.0.0.1:3000}"  # прямо в API: nginx отдаёт 404 всему, кроме своего server_name
python3 - "$ROOT" <<'PY'
import json, sys, urllib.request

BASE = sys.argv[1].rstrip('/') + '/v1'

def call(path, body=None, token=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method or ('POST' if data else 'GET'))
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, (json.loads(raw) if raw else {})

def login(phone):
    st, b = call('/auth/verify', {'phone': phone, 'code': '00000'})
    if 'accessToken' not in b: raise SystemExit(f'вход {phone} не удался: {st} {b}')
    return b['accessToken']

# 1. Заявки и контексты — на номера из таблицы демо-аккаунтов HANDOVER §4.
#    +998901239988 намеренно не трогаем: на нём видно приветственный промокод.
for phone in ('+998900000000', '+998901112233'):
    st, b = call('/app/demo/seed', {}, token=login(phone))
    print(f'  {phone}: заявок {b.get("orders")}, контекстов {b.get("contexts")}')

# 2. Фикстура прав B2B. Роль на точке выводится из потолка утверждения
#    (roleOf): null — организация, >0 — точка, 0 — сотрудник.
adm = login('+998900000000')
st, orgs = call('/admin/organizations', token=adm)
org = next((o for o in orgs if 'Шифо' in o['name']), None)
if not org: raise SystemExit('демо-организация «Шифо» не найдена — сначала сид заявок')
st, full = call(f'/admin/organizations/{org["id"]}', token=adm)
loc = {l['name']: l for l in full['locations']}

people = [
    ('Аптека Чиланзар', '+998900000803', 'Провизор',                 0,          False, 'сотрудник'),
    ('Аптека Юнусабад', '+998900000802', 'Руководитель точки',       100_000_000, True,  'руководитель точки'),
    ('Аптека Юнусабад', '+998900000804', 'Провизор',                 0,          False, 'сотрудник на той же точке'),
    ('Аптека Мирабад',  '+998900000801', 'Руководитель организации', None,       False, 'руководитель организации'),
]
for site, phone, role, limit, primary, human in people:
    l = loc.get(site)
    if not l: print(f'  ПРОПУСК {phone}: нет точки «{site}»'); continue
    exists = next((r for r in (l.get('representatives') or []) if r['phone'] == phone), None)
    if exists:
        rep_id = exists['id']
    else:
        st, rep = call(f'/admin/organizations/{org["id"]}/locations/{l["id"]}/representatives',
                       {'fullName': f'{human.capitalize()} (тест B2B)', 'phone': phone,
                        'role': role, 'approvalLimitTiyin': limit}, token=adm)
        if st >= 400: raise SystemExit(f'не удалось завести {phone}: {st} {rep}')
        rep_id = rep['id']
    # primary нужен не для актов: без него issueInvite отвечает 403, хотя
    # приложение кнопку «пригласить» показывает (расхождение контроллера и сервиса)
    if primary:
        call(f'/admin/organizations/{org["id"]}/locations/{l["id"]}/representatives/{rep_id}',
             {'primary': True}, token=adm, method='PUT')
    print(f'  {phone} → {site}: {human}')
print('\nГотово. Проверка: node sozo/apps/api/test/b2b-access-e2e.mjs')
PY
