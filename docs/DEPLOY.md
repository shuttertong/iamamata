# คู่มือขึ้นระบบจริง — GitHub Pages + Supabase + GitHub Actions

```
คุณแก้โค้ด → git push → GitHub Actions: build (ใส่ค่า Supabase) → GitHub Pages (หน้าเว็บ, HTTPS ฟรี)
ทุกเดือน:   GitHub Actions รัน Python อัปเดตข้อมูลถนน/โรงงาน → commit → deploy อัตโนมัติ
ผู้ใช้เปิดเว็บ → browser คุยกับ Supabase (รายงาน/admin/รูป) และ ThaiWater/Open-Meteo/RainViewer โดยตรง
```

- Repository: `https://github.com/shuttertong/iamamata`
- เว็บ: `https://shuttertong.github.io/iamamata/` (เปลี่ยนเป็นโดเมนของตัวเองได้ — ข้อ 4)
- ไม่ต้องมีเซิร์ฟเวอร์หรือ Python ของตัวเอง — Python รันใน GitHub Actions

> ขั้นที่ต้องใช้บัญชีและรหัสผ่าน **คุณทำเองทั้งหมด** — อย่าส่งรหัสผ่านหรือ key ลับให้ใครทางแชต

---

## 1. GitHub Pages — เปิดครั้งเดียว

- **Settings → Pages → Build and deployment → Source: GitHub Actions**
- ⚠️ GitHub Pages ฟรีใช้ได้กับ repository **Public** เท่านั้น ถ้า repository เป็น **Private** ต้องใช้ GitHub Pro/Team
  (โค้ดนี้เปิดเผยได้: ไม่มีรหัสผ่านในโค้ด และ anon key ของ Supabase ออกแบบมาให้เปิดเผยได้ — ความปลอดภัยอยู่ที่กติกา RLS ในฐานข้อมูล)
- ทุกครั้งที่ push ขึ้น `main` → แท็บ **Actions → Deploy to GitHub Pages** จะ build และขึ้นเว็บเอง (1–2 นาที)

## 2. Supabase (ฐานข้อมูล) — ประมาณ 15 นาที

1. สมัครที่ [supabase.com](https://supabase.com) → **New project**
   - Region: **Southeast Asia (Singapore)**
   - ตั้งรหัสผ่านฐานข้อมูลที่เดายาก แล้วเก็บไว้ในที่ปลอดภัย
2. **SQL Editor** → New query → วางทั้งไฟล์ `supabase/migrations/0001_init.sql` → **Run**
   ต้องขึ้น `Success` ถ้ามี error ให้คัดลอกข้อความ error มาให้ Claude ดู
3. **Authentication → Sign In / Providers**
   - เปิด **Allow anonymous sign-ins** (ประชาชนแจ้งได้โดยไม่ต้องสมัคร)
   - ปิด **Allow new users to sign up** (กันคนนอกสมัครเป็นผู้ใช้อีเมล)
4. **Authentication → URL Configuration** → Site URL = `https://shuttertong.github.io/iamamata/` (หรือโดเมนของคุณ)
5. สร้างบัญชีผู้ดูแล: **Authentication → Users → Add user** (อีเมล + รหัสผ่าน, ติ๊ก Auto Confirm) แล้วใน SQL Editor:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'อีเมลผู้ดูแล';
   ```
6. **Project Settings → API Keys** และ **Data API** จดไว้ 2 ค่า:
   - **Project URL** เช่น `https://abcd1234.supabase.co`
   - **Publishable key** (ขึ้นต้น `sb_publishable_...`) — หรือ **anon public** key แบบเดิม (ขึ้นต้น `eyJ...`) ใช้แทนกันได้ ค่านี้เปิดเผยได้
   - ⚠️ **ห้ามใช้ Secret key (`sb_secret_...`) หรือ `service_role` key** ในเว็บเด็ดขาด (สคริปต์ build จะปฏิเสธถ้าเผลอใส่)
7. (แนะนำ) กันบอท: สร้าง Turnstile site ที่ Cloudflare → ใส่ secret key ใน Supabase **Authentication → Attack Protection → CAPTCHA** และจด **site key** ไว้

## 3. ใส่ค่า Supabase ใน GitHub

**Settings → Secrets and variables → Actions → แท็บ Variables → New repository variable**

| ชื่อ | ค่า |
|---|---|
| `SUPABASE_URL` | Project URL จากข้อ 2.6 |
| `SUPABASE_ANON_KEY` | Publishable key (`sb_publishable_...`) จากข้อ 2.6 |
| `TURNSTILE_SITE_KEY` | (ถ้ามี) site key จากข้อ 2.7 |

แล้ว **Actions → Deploy to GitHub Pages → Run workflow** — เว็บจะเปลี่ยนจากโหมดทดลองเป็นระบบจริง (แถบเหลืองหายไป)

## 4. (ไม่บังคับ) ใช้โดเมนของตัวเอง

- **Settings → Pages → Custom domain** ใส่ เช่น `flood.example.com` → ติ๊ก **Enforce HTTPS**
- ที่ผู้ให้บริการโดเมน (เช่น Hostinger → DNS) เพิ่ม record `CNAME`: `flood` → `shuttertong.github.io`
- อย่าลืมแก้ Site URL ใน Supabase (ข้อ 2.4) ให้ตรงโดเมนใหม่

## 5. ตรวจหลังขึ้นเว็บ

- [ ] เปิดเว็บ — **ต้องไม่มีแถบเหลือง "ระบบทดลอง"** (ถ้ายังมี แปลว่ายังไม่ได้ใส่ Variables ข้อ 3 หรือยังไม่ได้ Run workflow ใหม่)
- [ ] แจ้งน้ำท่วม 1 จุดจากมือถือ (พร้อมรูป) → เปิด `…/admin.html` ล็อกอินผู้ดูแล → เห็นในคิว → ยืนยัน → กลับไปหน้าแผนที่ต้องเห็นจุด
- [ ] ขอความช่วยเหลือ 1 ครั้ง → admin เห็นเบอร์โทร / **เปิดหน้าแผนที่ในเครื่องอื่นต้องไม่เห็นเบอร์โทร**
- [ ] ป้ายฝน / น้ำทะเล / ระดับน้ำบางปะกง / เรดาร์ แสดงค่า
- [ ] ค้นหาชื่อโรงงาน เช่น "โตโยต้า", "Daikin"
- [ ] ลบข้อมูลทดสอบใน admin (เอาออกจากแผนที่) ก่อนประกาศใช้

## 6. การอัปเดตครั้งต่อไป

- แก้โค้ด → `git commit` → `git push` → ขึ้นเว็บเองภายใน 1–2 นาที
- ข้อมูลถนน/โรงงาน: อัปเดตเองทุกวันที่ 2 ของเดือน (Actions → **Refresh map data**) หรือกด **Run workflow** เมื่อต้องการ
- GitHub หยุดงานตามเวลาอัตโนมัติถ้า repository ไม่มีความเคลื่อนไหว 60 วัน → เข้าแท็บ Actions กดเปิดใหม่

## 7. แก้ปัญหา

| อาการ | วิธีแก้ |
|---|---|
| Deploy แดงที่ `configure-pages` / "Pages not enabled" | ทำข้อ 1 (Source: GitHub Actions) — ถ้า repository เป็น Private ต้องเปลี่ยนเป็น Public หรือใช้ GitHub Pro |
| ยังเห็นแถบ "ระบบทดลอง" | ใส่ Variables `SUPABASE_URL` + `SUPABASE_ANON_KEY` แล้ว Run workflow ใหม่ |
| admin ล็อกอินได้แต่ขึ้น "ไม่ใช่ผู้ดูแล" | ยังไม่ได้รันคำสั่ง `insert into public.admins …` ในข้อ 2.5 |
| เว็บเปิดได้แต่ข้อมูลเก่า | GitHub Pages แคชไฟล์ประมาณ 10 นาที — รอสักครู่หรือกด Cmd+Shift+R |

---

## ภาคผนวก: ใช้ Hostinger แทน GitHub Pages

มี workflow `.github/workflows/deploy.yml` (อัปโหลดผ่าน FTPS) — ตอนนี้ตั้งให้รันเมื่อกดเองเท่านั้น

1. hPanel → เปิด **SSL** ให้โดเมน → **Files → FTP Accounts → Create FTP account** ที่เข้าได้เฉพาะโฟลเดอร์เว็บ (เช่น `public_html/flood`)
2. GitHub **Settings → Secrets and variables → Actions**
   - Secrets: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`
   - Variables: `FTP_DIR` = `./` (ลงท้ายด้วย `/`), `FTP_PROTOCOL` (ไม่ต้องใส่ = `ftps`; ถ้า error เรื่อง TLS ให้ตั้ง `ftp`)
3. **Actions → Deploy to Hostinger → Run workflow**
4. ถ้าจะให้ Hostinger เป็นที่หลัก: ใน `deploy.yml` เพิ่ม `push: { branches: [main] }` ใต้ `on:` และใน `refresh-data.yml` ให้ job deploy เรียก `deploy.yml` (ดูหมายเหตุในไฟล์)
5. อัปโหลดเองครั้งเดียวก็ได้: `python3 tools/build_web.py` → อัปโหลด `dist/flood-map-web.zip` ใน File Manager → Extract (มี `.htaccess` บังคับ HTTPS ให้แล้ว)
