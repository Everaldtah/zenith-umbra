"""Hard spending cap for the xAI credit ($20 bought on 2026-10-04; auto top-up fires at a $5 balance).

Until work/topup_off exists (written after checking console.x.ai > Billing shows auto top-up disabled), the cap stays at
$14.90 so the balance never reaches $5. After that the cap is $19.60, which leaves ~$0.40 of headroom.
"""
import os, threading
import xai

LOCK = threading.Lock()
_reserved = [0.0]


def cap():
    return 19.60 if os.path.exists(os.path.join(xai.W, 'topup_off')) else 14.50


def check(cost):
    with LOCK:
        total = xai.spent() + _reserved[0] + cost
        if total > cap():
            raise SystemExit(f'BUDGET STOP: ${total:.2f} would pass the ${cap():.2f} cap')


def reserve(cost):
    with LOCK:
        check_total = xai.spent() + _reserved[0] + cost
        if check_total > cap(): raise SystemExit(f'BUDGET STOP: ${check_total:.2f} would pass the ${cap():.2f} cap')
        _reserved[0] += cost


def release(cost):
    with LOCK: _reserved[0] -= cost
