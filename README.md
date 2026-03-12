# RevoTickets

بوت تذاكر احترافي لـ Discord يعتمد على الأزرار + Slash Commands، مع حفظ دائم للبيانات وسجل شامل.

## لماذا النسخة هذه أقوى؟

- تحميل تلقائي لملف `.env` عبر `dotenv` (سبب شائع لفشل التشغيل تم إصلاحه).
- توحيد تعريف أوامر `/ticket` في ملف واحد مشترك بين التشغيل والنشر لتفادي عدم تطابق الأوامر.
- معالجة أخطاء مركزية داخل التفاعلات حتى لا يتوقف البوت عند أي خطأ مفاجئ.
- صلاحيات دقيقة: إدارة/دعم فقط للإجراءات الحساسة.
- تنظيف تلقائي لحالة التذكرة عند حذف القناة.
- Transcript HTML + Logs منظمة لكل الأحداث المهمة.

## الأوامر

`/ticket setup`
`/ticket message`
`/ticket staff-role`
`/ticket limit`
`/ticket close`
`/ticket reopen`
`/ticket delete`
`/ticket transcript`
`/ticket add`
`/ticket remove`
`/ticket rename`

## التشغيل الصحيح

1. تثبيت الحزم:
   ```bash
   npm install
   ```
2. إنشاء ملف البيئة:
   ```bash
   cp .env.example .env
   ```
3. عدّل `.env`:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID` (اختياري للتجربة السريعة على سيرفر واحد)
4. نشر الأوامر:
   ```bash
   npm run deploy
   ```
5. تشغيل البوت:
   ```bash
   npm start
   ```

## إعداد السيرفر

1. نفّذ `/ticket setup` وحدد:
   - روم البانل
   - فئة التذاكر
   - روم اللوغ
2. نفّذ `/ticket staff-role` لإضافة رتب الدعم.
3. نفّذ `/ticket limit 1` (أو حسب احتياجك).
4. نفّذ `/ticket message` لنشر زر فتح التذكرة.

## ملاحظة

لا يوجد نظام كلمة مرور داخل البوت. التحكم بالكامل مبني على صلاحيات Discord ورتب الدعم.
