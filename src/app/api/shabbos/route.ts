// app/api/shabbos/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { logger } from "@/lib/logger"

// Store these in environment variables
const MYZMANIM_API = {
    JSON_URL: 'https://api.myzmanim.com/engine1.json.aspx',
    USER: process.env.MYZMANIM_USER || '0017348426',
    KEY: process.env.MYZMANIM_KEY || 'b39acded156d0d01696651265ab3c6bb523934acc8c5fe5774db5e25cce79f8e0fab3eff48acfdc0'
}

// POST endpoint for getting zmanim by coordinates
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { action, latitude, longitude, zipCode } = body
        
        logger.info('Shabbos API called', { action, latitude, longitude, zipCode })
        
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
            details: error.response?.data || error.message
        }, { status: 500 })
    }
}

async function getZmanimByCoordinates(latitude: number, longitude: number) {
    if (!latitude || !longitude) {
        return NextResponse.json({ error: 'Latitude and longitude required' }, { status: 400 })
    }

    try {
        // Step 1: Search for LocationID using GPS coordinates with FORM POST
        const searchUrl = `${MYZMANIM_API.JSON_URL}/searchGps`
        
        // Create form data
        const formData = new URLSearchParams()
        formData.append('user', MYZMANIM_API.USER)
        formData.append('key', MYZMANIM_API.KEY)
        formData.append('coding', 'JSON')
        formData.append('latitude', latitude.toFixed(6))
        formData.append('longitude', longitude.toFixed(6))
        
        logger.info('Searching GPS with form POST', { 
            url: searchUrl,
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6)
        })

        const searchResponse = await axios.post(
            searchUrl,
            formData.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        )

        logger.info('Search response received', { 
            status: searchResponse.status,
            dataType: typeof searchResponse.data
        })

        // Check if we got JSON or a string
        let locationId
        if (typeof searchResponse.data === 'string') {
            try {
                const parsed = JSON.parse(searchResponse.data)
                locationId = parsed.LocationID
            } catch (e) {
                logger.error('Failed to parse search response', { data: searchResponse.data })
                throw new Error('Invalid response from GPS search')
            }
        } else {
            locationId = searchResponse.data.LocationID
        }

        if (!locationId) {
            throw new Error('Location ID not found')
        }

        logger.info(`Found LocationID: ${locationId}`)

        // Step 2: Get zmanim using LocationID with FORM POST
        const zmanimUrl = `${MYZMANIM_API.JSON_URL}/getDay`
        
        const zmanimFormData = new URLSearchParams()
        zmanimFormData.append('user', MYZMANIM_API.USER)
        zmanimFormData.append('key', MYZMANIM_API.KEY)
        zmanimFormData.append('coding', 'JSON')
        zmanimFormData.append('language', 'en')
        zmanimFormData.append('locationid', locationId)
        zmanimFormData.append('inputdate', new Date().toISOString().split('T')[0])

        logger.info('Fetching zmanim with form POST', { 
            url: zmanimUrl,
            locationId: locationId
        })

        const zmanimResponse = await axios.post(
            zmanimUrl,
            zmanimFormData.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        )

        // Parse response if it's a string
        let zmanimData
        if (typeof zmanimResponse.data === 'string') {
            try {
                zmanimData = JSON.parse(zmanimResponse.data)
            } catch (e) {
                logger.error('Failed to parse zmanim response', { data: zmanimResponse.data })
                throw new Error('Invalid response from zmanim API')
            }
        } else {
            zmanimData = zmanimResponse.data
        }
        
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
                CandleLighting: zmanimData.Zman?.Candles || zmanimData.Zman?.Candles18,
                ShabbosEnds: zmanimData.Zman?.NightShabbos || zmanimData.Zman?.Night72,
                Sunrise: zmanimData.Zman?.SunriseDefault,
                Sunset: zmanimData.Zman?.SunsetDefault,
                Tzais: zmanimData.Zman?.Night72fix,
                Tzais72: zmanimData.Zman?.Night72,
                ShachrisGRA: zmanimData.Zman?.ShachrisGra || zmanimData.Zman?.ShemaGra,
                ShachrisMGA: zmanimData.Zman?.ShachrisMA72 || zmanimData.Zman?.ShemaMA72,
                Chatzos: zmanimData.Zman?.Midday,
                MinchaGedola: zmanimData.Zman?.MinchaGra,
                MinchaKetana: zmanimData.Zman?.KetanaGra,
                PlagHamincha: zmanimData.Zman?.PlagGra
            }
        })
    } catch (error: any) {
        logger.error('Zmanim coordinates error:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        })
        
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim',
            details: error.response?.data || error.message
        }, { status: 500 })
    }
}

async function getZmanimByZip(zipCode: string) {
    if (!zipCode) {
        return NextResponse.json({ error: 'ZIP code required' }, { status: 400 })
    }

    try {
        // Step 1: Search by postal code with FORM POST
        const searchUrl = `${MYZMANIM_API.JSON_URL}/searchPostal`
        
        const formData = new URLSearchParams()
        formData.append('user', MYZMANIM_API.USER)
        formData.append('key', MYZMANIM_API.KEY)
        formData.append('coding', 'JSON')
        formData.append('query', zipCode)

        logger.info('Searching postal code with form POST', { 
            url: searchUrl,
            zipCode: zipCode
        })

        const searchResponse = await axios.post(
            searchUrl,
            formData.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        )

        // Parse response if it's a string
        let locationId
        if (typeof searchResponse.data === 'string') {
            try {
                const parsed = JSON.parse(searchResponse.data)
                locationId = parsed.LocationID
            } catch (e) {
                logger.error('Failed to parse postal search response', { data: searchResponse.data })
                throw new Error('Invalid response from postal search')
            }
        } else {
            locationId = searchResponse.data.LocationID
        }

        if (!locationId) {
            throw new Error('Location not found for ZIP code')
        }

        logger.info(`Found LocationID for ZIP ${zipCode}: ${locationId}`)

        // Step 2: Get zmanim using LocationID (same as coordinates method)
        const zmanimUrl = `${MYZMANIM_API.JSON_URL}/getDay`
        
        const zmanimFormData = new URLSearchParams()
        zmanimFormData.append('user', MYZMANIM_API.USER)
        zmanimFormData.append('key', MYZMANIM_API.KEY)
        zmanimFormData.append('coding', 'JSON')
        zmanimFormData.append('language', 'en')
        zmanimFormData.append('locationid', locationId)
        zmanimFormData.append('inputdate', new Date().toISOString().split('T')[0])

        const zmanimResponse = await axios.post(
            zmanimUrl,
            zmanimFormData.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        )

        // Parse response if it's a string
        let zmanimData
        if (typeof zmanimResponse.data === 'string') {
            try {
                zmanimData = JSON.parse(zmanimResponse.data)
            } catch (e) {
                logger.error('Failed to parse zmanim response', { data: zmanimResponse.data })
                throw new Error('Invalid response from zmanim API')
            }
        } else {
            zmanimData = zmanimResponse.data
        }
        
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
                CandleLighting: zmanimData.Zman?.Candles || zmanimData.Zman?.Candles18,
                ShabbosEnds: zmanimData.Zman?.NightShabbos || zmanimData.Zman?.Night72,
                Sunrise: zmanimData.Zman?.SunriseDefault,
                Sunset: zmanimData.Zman?.SunsetDefault,
                Tzais: zmanimData.Zman?.Night72fix,
                Tzais72: zmanimData.Zman?.Night72,
                ShachrisGRA: zmanimData.Zman?.ShachrisGra || zmanimData.Zman?.ShemaGra,
                ShachrisMGA: zmanimData.Zman?.ShachrisMA72 || zmanimData.Zman?.ShemaMA72,
                Chatzos: zmanimData.Zman?.Midday,
                MinchaGedola: zmanimData.Zman?.MinchaGra,
                MinchaKetana: zmanimData.Zman?.KetanaGra,
                PlagHamincha: zmanimData.Zman?.PlagGra
            }
        })
    } catch (error: any) {
        logger.error('Zmanim ZIP error:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status
        })
        
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim for ZIP code',
            details: error.response?.data || error.message
        }, { status: 500 })
    }
}