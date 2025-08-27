// app/api/shabbos/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { logger } from "@/lib/logger"

// Store these in environment variables
const MYZMANIM_API = {
    BASE_URL: 'https://api.myzmanim.com/engine1.svc',
    USER: process.env.MYZMANIM_USER || '0017348426',
    KEY: process.env.MYZMANIM_KEY || 'b39acded156d0d01696651265ab3c6bb523934acc8c5fe5774db5e25cce79f8e0fab3eff48acfdc0'
}

// POST endpoint for getting zmanim by coordinates
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { action, latitude, longitude, zipCode } = body
        
        // Route based on action
        if (action === 'coordinates') {
            return await getZmanimByCoordinates(latitude, longitude)
        } else if (action === 'zip') {
            return await getZmanimByZip(zipCode)
        } else {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
        }
    } catch (error: any) {
        logger.error('Zmanim API Error:', error.response?.data || error.message)
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim',
            details: error.response?.data?.ErrMsg || error.message
        }, { status: 500 })
    }
}

async function getZmanimByCoordinates(latitude: number, longitude: number) {
    if (!latitude || !longitude) {
        return NextResponse.json({ error: 'Latitude and longitude required' }, { status: 400 })
    }

    try {
        // Step 1: Get LocationID from coordinates using POST with form data
        const searchParams = new URLSearchParams({
            user: MYZMANIM_API.USER,
            key: MYZMANIM_API.KEY,
            coding: 'JSON',
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6)
        })

        const searchResponse = await axios.post(
            `${MYZMANIM_API.BASE_URL}/searchGps`,
            searchParams.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        )

        if (!searchResponse.data || !searchResponse.data.LocationID) {
            logger.error('Search response:', searchResponse.data)
            throw new Error('Location ID not found')
        }

        const locationId = searchResponse.data.LocationID
        logger.info(`Found LocationID: ${locationId}`)

        // Step 2: Get zmanim using LocationID
        const zmanimParams = new URLSearchParams({
            user: MYZMANIM_API.USER,
            key: MYZMANIM_API.KEY,
            coding: 'JSON',
            language: 'en',
            locationid: locationId,
            inputdate: new Date().toISOString().split('T')[0] // YYYY-MM-DD format
        })

        const zmanimResponse = await axios.post(
            `${MYZMANIM_API.BASE_URL}/getDay`,
            zmanimParams.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        )

        const zmanimData = zmanimResponse.data
        
        // Transform the response to match your app's expected format
        return NextResponse.json({
            success: true,
            locationId: locationId,
            location: {
                name: zmanimData.Place?.Name,
                city: zmanimData.Place?.City,
                state: zmanimData.Place?.State
            },
            date: zmanimData.Time?.DateCivil,
            isShabbos: zmanimData.Time?.IsShabbos || false,
            isYomTov: zmanimData.Time?.IsYomTov || false,
            zmanim: {
                CandleLighting: zmanimData.Zman?.Candles,
                ShabbosEnds: zmanimData.Zman?.NightShabbos,
                Sunrise: zmanimData.Zman?.SunriseDefault,
                Sunset: zmanimData.Zman?.SunsetDefault,
                Tzais: zmanimData.Zman?.Night72fix,
                Tzais72: zmanimData.Zman?.Night72,
                ShachrisGRA: zmanimData.Zman?.ShachrisGra,
                ShachrisMGA: zmanimData.Zman?.ShachrisMA72,
                Chatzos: zmanimData.Zman?.Midday,
                MinchaGedola: zmanimData.Zman?.MinchaGra,
                MinchaKetana: zmanimData.Zman?.KetanaGra,
                PlagHamincha: zmanimData.Zman?.PlagGra
            }
        })
    } catch (error: any) {
        logger.error('Zmanim coordinates error:', error.response?.data || error.message)
        throw error
    }
}

async function getZmanimByZip(zipCode: string) {
    if (!zipCode) {
        return NextResponse.json({ error: 'ZIP code required' }, { status: 400 })
    }

    try {
        // Step 1: Search by postal code
        const searchParams = new URLSearchParams({
            user: MYZMANIM_API.USER,
            key: MYZMANIM_API.KEY,
            coding: 'JSON',
            query: zipCode
        })

        const searchResponse = await axios.post(
            `${MYZMANIM_API.BASE_URL}/searchPostal`,
            searchParams.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        )

        if (!searchResponse.data || !searchResponse.data.LocationID) {
            logger.error('Search response:', searchResponse.data)
            throw new Error('Location not found for ZIP code')
        }

        const locationId = searchResponse.data.LocationID
        logger.info(`Found LocationID for ZIP ${zipCode}: ${locationId}`)

        // Step 2: Get zmanim using LocationID
        const zmanimParams = new URLSearchParams({
            user: MYZMANIM_API.USER,
            key: MYZMANIM_API.KEY,
            coding: 'JSON',
            language: 'en',
            locationid: locationId,
            inputdate: new Date().toISOString().split('T')[0]
        })

        const zmanimResponse = await axios.post(
            `${MYZMANIM_API.BASE_URL}/getDay`,
            zmanimParams.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        )

        const zmanimData = zmanimResponse.data
        
        return NextResponse.json({
            success: true,
            locationId: locationId,
            location: {
                name: zmanimData.Place?.Name,
                city: zmanimData.Place?.City,
                state: zmanimData.Place?.State,
                zipCode: zmanimData.Place?.PostalCode || zipCode
            },
            date: zmanimData.Time?.DateCivil,
            isShabbos: zmanimData.Time?.IsShabbos || false,
            isYomTov: zmanimData.Time?.IsYomTov || false,
            zmanim: {
                CandleLighting: zmanimData.Zman?.Candles,
                ShabbosEnds: zmanimData.Zman?.NightShabbos,
                Sunrise: zmanimData.Zman?.SunriseDefault,
                Sunset: zmanimData.Zman?.SunsetDefault,
                Tzais: zmanimData.Zman?.Night72fix,
                Tzais72: zmanimData.Zman?.Night72,
                ShachrisGRA: zmanimData.Zman?.ShachrisGra,
                ShachrisMGA: zmanimData.Zman?.ShachrisMA72,
                Chatzos: zmanimData.Zman?.Midday,
                MinchaGedola: zmanimData.Zman?.MinchaGra,
                MinchaKetana: zmanimData.Zman?.KetanaGra,
                PlagHamincha: zmanimData.Zman?.PlagGra
            }
        })
    } catch (error: any) {
        logger.error('Zmanim ZIP error:', error.response?.data || error.message)
        throw error
    }
}