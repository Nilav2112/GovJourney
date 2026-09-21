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
The schema is in `db/schema.sql`. The current UI is designed to work as a local-first academic prototype even without a configured database. The Express server exposes health/config endpoints and can be extended for production authentication and persistence.

## Important
This is an academic prototype, not an official government service. Requirements and links must be verified on the official government portal before real-world use.
