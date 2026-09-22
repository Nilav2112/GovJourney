# GovJourney — Full Website

A complete academic prototype for a citizen government-service navigation platform.

## Included
- 20 life-event journeys (more than 10)
- Search and category filters
- Personalized question flow
- Step-by-step dependency roadmap
- Progress tracking and saved journeys
- Document checklist and browser-local digital vault
- Office locator with Google Maps directions
- Notifications
- Reminders and downloadable `.ics` calendar files
- Journey report download
- English / Hindi / Kannada language selector
- Voice input assistant and chatbot
- PWA/offline shell
- Admin console with analytics and add/remove event controls
- Express.js server
- PostgreSQL schema foundation
- Responsive laptop/mobile design
- Supplied GovJourney logo

## Run in VS Code
```powershell
npm install
npm start
```
Open `http://localhost:3000`.

## PostgreSQL
The schema is in `db/schema.sql`. Set `DATABASE_URL`, `JWT_SECRET`, and `VAULT_ENCRYPTION_KEY` in a `.env` file using `.env.example`, then start the server. The API initializes the schema and seeds the pilot life-event catalogue when PostgreSQL is available. Authentication uses short-lived JWT sessions, journeys and reminders are ownership-scoped, and vault uploads are encrypted before storage. Without `DATABASE_URL`, the same routes run with an in-memory demo fallback so the UI remains usable.

The main API checks are available at `/api/health`, `/api/events`, `/api/auth/register`, `/api/auth/login`, `/api/journeys`, `/api/reminders`, `/api/vault`, and `/api/chat`. Run `npm test` for the automated API checks.

## DigiLocker
The Documents area links citizens to DigiLocker and supports an OAuth connection when approved DigiLocker partner credentials are configured. Add `DIGILOCKER_CLIENT_ID`, `DIGILOCKER_CLIENT_SECRET`, `DIGILOCKER_REDIRECT_URI`, and `DIGILOCKER_AUTH_URL` to `.env`. DigiLocker access cannot be implemented as an anonymous public document fetch; users must authenticate with DigiLocker and the application must be registered with the DigiLocker partner API.

## Important
This is an academic prototype, not an official government service. Requirements and links must be verified on the official government portal before real-world use.
