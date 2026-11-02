/ Student Management System

/ About the Project
This is my Student Management System project. I made it to help a college manage student details, courses, and instructors in one place.

/ Main Features
- Admin can add, update, search, and delete student records.
- Admin can add courses and instructors and assign an instructor to a course.
- Admin can manage course/program names and study durations for student registration.
- Students can view their own profile and see the courses and instructors.
- Admin can manage user roles and view student reports.
- Student records can be imported and exported as files.

/ Technologies Used
- React
- Node.js and Express
- MongoDB and Mongoose

/ Requirements
- Node.js 20 or newer
- npm
- MongoDB Community Server or MongoDB Atlas

/ How to Run

/ Start the backend
Open PowerShell in the project folder and run:
```powershell
Copy-Item server/.env.example server/.env
cd server
npm install
```
Add your MongoDB connection and Admin details to `server/.env`. Email notifications and password-reset emails use SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and optionally `EMAIL_FROM`). For Gmail, use an App Password rather than your normal account password. Configure the same SMTP variables in the backend Render service's environment settings; otherwise application emails cannot be delivered. Keep credentials private.
For the current Render deployment, map the URLs as follows:

- Frontend `VITE_API_URL`: `https://server-7a1u.onrender.com` (defaulted by `client/.env.production`; a Render environment variable can override it)
- Backend `CLIENT_ORIGIN`: `https://client-kpqq.onrender.com`

Redeploy the frontend after changing its build-time API URL and redeploy the backend after changing its CORS configuration. The root `render.yaml` includes the Render static-site rewrite from `/*` to `/index.html`, required for React Router paths such as `/register` to work on direct visits and refreshes. Sync this Blueprint configuration with Render to apply the rule. If the existing frontend service is not managed by a Blueprint, add the same rule in its **Redirects/Rewrites** settings.

Then run:

```powershell
npm run create-admin
npm run dev
```

Student registration offers B-Tech, Degree, Pharmacy, and MTech, with study years limited by the selected course.

/ Start the frontend
Open another PowerShell window in the project folder and run:

```powershell
Copy-Item client/.env.example client/.env
cd client
npm install
npm run dev
```
Open the address shown in the terminal. It is usually `http://localhost:5174`.

/ Testing
Run these commands from the project folder:

```powershell
npm --prefix server test
npm --prefix client test
```
To make a production build, run:

```powershell
npm --prefix client run build
```
