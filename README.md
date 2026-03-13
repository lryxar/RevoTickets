# RevoTickets — Python Only (Advanced)

بوت تذاكر احترافي بـ **Python فقط** باستخدام `discord.py` — بدون أي Runtime JavaScript.

## مميزات قوية

- نظام تذاكر بالأزرار
- نظام Slash Commands متعدد وكامل
- صلاحيات دقيقة للدعم/الإدارة
- تخصيصات متقدمة (Prefix / Welcome / Cooldown / Auto-Close)
- Transcript HTML + Logs احترافية
- حفظ دائم للإعدادات والتذاكر في `data.json`

## التثبيت

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## الإعداد

```bash
cp .env.example .env
```

املأ:

- `DISCORD_TOKEN`
- `GUILD_ID` (اختياري)

## التشغيل

```bash
python src/bot.py
```

## مزامنة الأوامر (اختياري)

```bash
python src/deploy_commands.py
```

## أوامر البوت (متعددة)

### إعداد وإدارة النظام
- `/ticket setup`
- `/ticket message`
- `/ticket settings`
- `/ticket set_prefix`
- `/ticket set_welcome`
- `/ticket set_cooldown`
- `/ticket set_autoclose`
- `/ticket staff_add`
- `/ticket staff_remove`
- `/ticket staff_list`
- `/ticket limit`

### إدارة التذكرة
- `/ticket claim`
- `/ticket unclaim`
- `/ticket close`
- `/ticket reopen`
- `/ticket delete`
- `/ticket transcript`
- `/ticket add`
- `/ticket remove`
- `/ticket rename`
- `/ticket move`
- `/ticket priority`
- `/ticket stats`
- `/ticket info`

## ملاحظات

- المشروع Python-only بالكامل.
- التحكم مبني على صلاحيات Discord + رتب الدعم.
- يوجد تنظيف تلقائي للبيانات عند حذف قناة التذكرة.
