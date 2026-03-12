# RevoTickets

بوت Discord احترافي لإدارة نظام التذاكر بالأزرار و Slash Commands مع حفظ كامل للبيانات.

## المميزات القوية

- فتح التذكرة بزر `🎟️ Open Ticket`.
- أوامر `/ticket` متكاملة:
  - `setup`, `message`, `staff-role`, `limit`
  - `close`, `reopen`, `delete`, `transcript`
  - `add`, `remove`, `rename`
- نظام صلاحيات قوي:
  - الإدارة + رتب الدعم فقط لإدارة حساسة (Claim/Delete/Add/Remove).
  - صاحب التذكرة يمكنه التعامل مع تذكرته ضمن الحدود.
- حفظ دائم في `data.json` حتى بعد إعادة التشغيل.
- Anti-Spam/Rate Limit لمنع فتح تذاكر بسرعة.
- Transcript HTML لكل تذكرة.
- نظام Log احترافي لكل عمليات التذكرة.

## التشغيل

1. تثبيت الحزم:
   ```bash
   npm install
   ```
2. إنشاء ملف البيئة:
   ```bash
   cp .env.example .env
   ```
3. تعبئة القيم:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID` (اختياري للنشر السريع)
4. نشر الأوامر:
   ```bash
   npm run deploy
   ```
5. تشغيل البوت:
   ```bash
   npm start
   ```

> لا يوجد أي نظام كلمة مرور داخل البوت. التحكم يتم عبر صلاحيات Discord فقط.

## الإعداد لأول مرة داخل السيرفر

1. نفّذ `/ticket setup` وحدد:
   - روم البانل
   - فئة التذاكر
   - روم اللوغ
2. نفّذ `/ticket staff-role` لإضافة رتبة الدعم.
3. نفّذ `/ticket limit 1` (أو قيمة من 1 إلى 5).
4. نفّذ `/ticket message` لإرسال رسالة فتح التذكرة.

## ملاحظة

- اسم التذكرة تلقائي: `ticket-001`, `ticket-002`, ...
