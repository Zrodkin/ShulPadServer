// app/api/shabbos/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { logger } from "@/lib/logger"

// Store these in environment variables
const MYZMANIM_API = {
    BASE_URL: 'https://api.myzmanim.com/engine1.svc',
    JSON_URL: 'https://api.myzmanim.com/engine1.json.aspx', // Alternative endpoint
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
            details: error.response?.data?.ErrMsg || error.message
        }, { status: 500 })
    }
}

async function getZmanimByCoordinates(latitude: number, longitude: number) {
    if (!latitude || !longitude) {
        return NextResponse.json({ error: 'Latitude and longitude required' }, { status: 400 })
    }

    try {
        // Try Method 1: Using GET request with query parameters (like the iOS app)
        const searchUrl = `${MYZMANIM_API.BASE_URL}/searchGps`
        const searchParams = new URLSearchParams({
            User: MYZMANIM_API.USER,
            Key: MYZMANIM_API.KEY,
            Coding: 'JSON',
            Latitude: latitude.toFixed(6),
            Longitude: longitude.toFixed(6)
        })
        
        logger.info('Searching GPS with GET request', { 
            url: `${searchUrl}?${searchParams.toString()}` 
        })

        let searchResponse
        try {
            // First try GET request (like the iOS app does)
            searchResponse = await axios.get(`${searchUrl}?${searchParams.toString()}`, {
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000
            })
        } catch (getError: any) {
            logger.warn('GET request failed, trying POST', { error: getError.message })
            
            // If GET fails, try POST with form data
            searchResponse = await axios.post(
                searchUrl,
                searchParams.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                }
            )
        }

        logger.info('Search response received', { 
            data: searchResponse.data,
            status: searchResponse.status 
        })

        if (!searchResponse.data || !searchResponse.data.LocationID) {
            // Try alternative: Use the JSON endpoint directly
            logger.warn('No LocationID found, trying alternative JSON endpoint')
            
            const altUrl = `${MYZMANIM_API.JSON_URL}`
            const altParams = new URLSearchParams({
                coding: 'JSON',
                language: 'en',
                latitude: latitude.toFixed(6),
                longitude: longitude.toFixed(6),
                key: MYZMANIM_API.KEY,
                user: MYZMANIM_API.USER,
                inputdate: new Date().toISOString().split('T')[0]
            })
            
            const altResponse = await axios.get(`${altUrl}?${altParams.toString()}`, {
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000
            })
            
            if (altResponse.data) {
                return transformAlternativeResponse(altResponse.data)
            }
            
            throw new Error('Location ID not found')
        }

        const locationId = searchResponse.data.LocationID
        logger.info(`Found LocationID: ${locationId}`)

        // Step 2: Get zmanim using LocationID
        const zmanimUrl = `${MYZMANIM_API.BASE_URL}/getDay`
        const zmanimParams = new URLSearchParams({
            User: MYZMANIM_API.USER,
            Key: MYZMANIM_API.KEY,
            Coding: 'JSON',
            Language: 'en',
            LocationId: locationId,
            InputDate: new Date().toISOString().split('T')[0]
        })

        logger.info('Fetching zmanim', { 
            url: `${zmanimUrl}?${zmanimParams.toString()}` 
        })

        // Try GET first, then POST if it fails
        let zmanimResponse
        try {
            zmanimResponse = await axios.get(`${zmanimUrl}?${zmanimParams.toString()}`, {
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000
            })
        } catch (getError: any) {
            logger.warn('GET request for zmanim failed, trying POST', { error: getError.message })
            
            zmanimResponse = await axios.post(
                zmanimUrl,
                zmanimParams.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                }
            )
        }

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
        // Step 1: Search by postal code
        const searchUrl = `${MYZMANIM_API.BASE_URL}/searchPostal`
        const searchParams = new URLSearchParams({
            User: MYZMANIM_API.USER,
            Key: MYZMANIM_API.KEY,
            Coding: 'JSON',
            Query: zipCode
        })

        logger.info('Searching postal code', { 
            url: `${searchUrl}?${searchParams.toString()}` 
        })

        // Try GET first
        let searchResponse
        try {
            searchResponse = await axios.get(`${searchUrl}?${searchParams.toString()}`, {
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000
            })
        } catch (getError: any) {
            logger.warn('GET request failed for postal search, trying POST', { error: getError.message })
            
            searchResponse = await axios.post(
                searchUrl,
                searchParams.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                }
            )
        }

        if (!searchResponse.data || !searchResponse.data.LocationID) {
            logger.error('Search response:', searchResponse.data)
            throw new Error('Location not found for ZIP code')
        }

        const locationId = searchResponse.data.LocationID
        logger.info(`Found LocationID for ZIP ${zipCode}: ${locationId}`)

        // Step 2: Get zmanim using LocationID (same as coordinates method)
        const zmanimUrl = `${MYZMANIM_API.BASE_URL}/getDay`
        const zmanimParams = new URLSearchParams({
            User: MYZMANIM_API.USER,
            Key: MYZMANIM_API.KEY,
            Coding: 'JSON',
            Language: 'en',
            LocationId: locationId,
            InputDate: new Date().toISOString().split('T')[0]
        })

        let zmanimResponse
        try {
            zmanimResponse = await axios.get(`${zmanimUrl}?${zmanimParams.toString()}`, {
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000
            })
        } catch (getError: any) {
            logger.warn('GET request for zmanim failed, trying POST', { error: getError.message })
            
            zmanimResponse = await axios.post(
                zmanimUrl,
                zmanimParams.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                }
            )
        }

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

// Helper function to transform alternative API response format
function transformAlternativeResponse(data: any) {
    return NextResponse.json({
        success: true,
        locationId: data.LocationID || 'unknown',
        location: {
            name: data.Place?.Name,
            city: data.Place?.City,
            state: data.Place?.State
        },
        date: data.Time?.DateCivil,
        isShabbos: data.Time?.IsShabbos || false,
        isYomTov: data.Time?.IsYomTov || false,
        zmanim: {
            CandleLighting: data.Zman?.Candles || data.Zman?.Candles18,
            ShabbosEnds: data.Zman?.NightShabbos || data.Zman?.Night72,
            Sunrise: data.Zman?.SunriseDefault,
            Sunset: data.Zman?.SunsetDefault,
            Tzais: data.Zman?.Night72fix,
            Tzais72: data.Zman?.Night72,
            ShachrisGRA: data.Zman?.ShachrisGra || data.Zman?.ShemaGra,
            ShachrisMGA: data.Zman?.ShachrisMA72 || data.Zman?.ShemaMA72,
            Chatzos: data.Zman?.Midday,
            MinchaGedola: data.Zman?.MinchaGra,
            MinchaKetana: data.Zman?.KetanaGra,
            PlagHamincha: data.Zman?.PlagGra
        }
    })
}