import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function GET() {
    try {
        const transporter = nodemailer.createTransport({
            host: "smtp.gmail.com",
            port: 587,
            secure: false, // upgrades to STARTTLS
            auth: {
                user: process.env.EMAIL_USER?.trim(),
                pass: process.env.EMAIL_PASS?.trim(),
            },
        });

        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // send to yourself
            subject: "Test Email from Railway",
            text: "If you see this, email sending is working!",
        });

        return NextResponse.json({ 
            success: true, 
            message: "Email sent successfully!",
            info: info.response,
            user: process.env.EMAIL_USER
        });
    } catch (error: any) {
        return NextResponse.json({ 
            success: false, 
            error: error.message,
            stack: error.stack,
            code: error.code,
            userConfigured: !!process.env.EMAIL_USER,
            passConfigured: !!process.env.EMAIL_PASS,
        }, { status: 500 });
    }
}
