# BM Time — Simple MVP

A deliberately small, location-based employee time clock.

## Included
- Dedicated kiosk screen with 4-digit PIN keypad
- Clock In and Clock Out only
- Automatic reset after each punch
- Kiosk fixed to one location through environment variables
- Simple password-protected manager status screen
- Supabase schema for locations, job titles, employees, kiosks and punches
- Demo mode for testing before Supabase is connected

## Run the demo
1. Copy `.env.example` to `.env.local`.
2. Set `KIOSK_TOKEN` and `NEXT_PUBLIC_KIOSK_TOKEN` to the same long random value.
3. Set `MANAGER_PASSWORD`.
4. Leave `NEXT_PUBLIC_DEMO_MODE=true`.
5. Run `npm install` and `npm run dev`.
6. Open `/kiosk`. Demo PINs are `1234`, `2468`, and `7300`.
7. Open `/manager` and enter your manager password.

## Connect Supabase
1. Create a Supabase project and run `supabase/schema.sql`.
2. Add the project URL and service-role key to `.env.local` and Vercel.
3. Create one kiosk row whose `token` matches the kiosk token in Vercel.
4. Add employees with bcrypt-hashed 4-digit PINs.
5. Set `NEXT_PUBLIC_DEMO_MODE=false` and redeploy.

## One Vercel project per kiosk location
For the simplest setup, deploy the same repository four times with different values for:
- `NEXT_PUBLIC_KIOSK_LOCATION`
- `NEXT_PUBLIC_KIOSK_NAME`
- `KIOSK_TOKEN`
- `NEXT_PUBLIC_KIOSK_TOKEN`

That gives each branch a dedicated URL and keeps employees from selecting a location.

## Not included yet
Breaks, scheduling, PTO, mobile punching, GPS, offline mode, payroll integration and complicated permissions.
