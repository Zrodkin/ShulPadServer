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

// Helper function to calculate candle lighting from sunset
function calculateCandleLighting(sunsetTime: string, minutes: number = 18): string | null {
    if (!sunsetTime) return null;
    
    // Parse time string (e.g., "8:39 PM" or "20:39")
    const timeParts = sunsetTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!timeParts) {
        logger.warn('Unable to parse sunset time for candle lighting calculation', { sunsetTime });
        return null;
    }
    
    let hours = parseInt(timeParts[1]);
    const mins = parseInt(timeParts[2]);
    const isPM = timeParts[3]?.toUpperCase() === 'PM';
    
    // Convert to 24-hour format if needed
    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
    
    // Calculate candle lighting time (subtract minutes)
    const totalMinutes = hours * 60 + mins - minutes;
    const candleHours = Math.floor(totalMinutes / 60);
    const candleMins = totalMinutes % 60;
    
    // Format back to 12-hour with AM/PM
    const displayHour = candleHours === 0 ? 12 : (candleHours > 12 ? candleHours - 12 : candleHours);
    const ampm = candleHours >= 12 ? 'PM' : 'AM';
    
    return `${displayHour}:${candleMins.toString().padStart(2, '0')} ${ampm}`;
}

// POST endpoint for getting zmanim by coordinates
export async function POST(request: NextRequest) {
    const requestId = Math.random().toString(36).substring(7); // For tracking requests
    const startTime = Date.now();
    
    try {
        const body = await request.json()
        const { action, latitude, longitude, zipCode } = body
        
        logger.info('🔵 Shabbos API Request Started', { 
            requestId,
            action, 
            latitude, 
            longitude, 
            zipCode,
            timestamp: new Date().toISOString(),
            userAgent: request.headers.get('user-agent')
        })
        
        // Route based on action
        let result;
        if (action === 'coordinates') {
            result = await getZmanimByCoordinates(latitude, longitude, requestId)
        } else if (action === 'zip') {
            result = await getZmanimByZip(zipCode, requestId)
        } else {
            logger.warn('Invalid action provided', { requestId, action })
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
        }
        
        const totalTime = Date.now() - startTime;
        logger.info('🟢 Shabbos API Request Completed', { 
            requestId,
            totalTimeMs: totalTime,
            success: result.status === 200
        })
        
        return result;
        
    } catch (error: any) {
        const totalTime = Date.now() - startTime;
        logger.error('🔴 Shabbos API Request Failed', {
            requestId,
            totalTimeMs: totalTime,
            error: error.response?.data || error.message,
            stack: error.stack
        })
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim',
            details: error.response?.data || error.message
        }, { status: 500 })
    }
}

async function getZmanimByCoordinates(latitude: number, longitude: number, requestId: string) {
    if (!latitude || !longitude) {
        logger.warn('Missing coordinates', { requestId, latitude, longitude })
        return NextResponse.json({ error: 'Latitude and longitude required' }, { status: 400 })
    }

    try {
        // Step 1: Search for LocationID using GPS coordinates
        const searchStartTime = Date.now();
        const searchUrl = `${MYZMANIM_API.JSON_URL}/searchGps`
        
        const formData = new URLSearchParams()
        formData.append('user', MYZMANIM_API.USER)
        formData.append('key', MYZMANIM_API.KEY)
        formData.append('coding', 'JSON')
        formData.append('latitude', latitude.toFixed(6))
        formData.append('longitude', longitude.toFixed(6))
        
        logger.info('📍 Searching GPS coordinates', { 
            requestId,
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

        const searchTime = Date.now() - searchStartTime;
        logger.info('GPS search response received', { 
            requestId,
            status: searchResponse.status,
            responseTimeMs: searchTime,
            dataType: typeof searchResponse.data
        })

        // Parse LocationID from response
        let locationId
        if (typeof searchResponse.data === 'string') {
            try {
                const parsed = JSON.parse(searchResponse.data)
                locationId = parsed.LocationID
                logger.debug('Parsed LocationID from string response', { requestId, locationId })
            } catch (e) {
                logger.error('Failed to parse GPS search response', { 
                    requestId,
                    data: searchResponse.data?.substring(0, 500) 
                })
                throw new Error('Invalid response from GPS search')
            }
        } else {
            locationId = searchResponse.data.LocationID
        }

        if (!locationId) {
            logger.error('No LocationID found for coordinates', { 
                requestId,
                latitude,
                longitude,
                response: searchResponse.data 
            })
            throw new Error('Location ID not found')
        }

        logger.info('✅ Found LocationID', { requestId, locationId })

        // Step 2: Get zmanim using LocationID
        const zmanimStartTime = Date.now();
        const zmanimUrl = `${MYZMANIM_API.JSON_URL}/getDay`
        
        // Calculate local date
        const localDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
        const currentDateTime = new Date();
        
        const zmanimFormData = new URLSearchParams()
        zmanimFormData.append('user', MYZMANIM_API.USER)
        zmanimFormData.append('key', MYZMANIM_API.KEY)
        zmanimFormData.append('coding', 'JSON')
        zmanimFormData.append('language', 'en')
        zmanimFormData.append('locationid', locationId)
        zmanimFormData.append('inputdate', localDate)

        logger.info('📅 Fetching zmanim for date', { 
            requestId,
            locationId,
            inputDate: localDate,
            currentDateTime: currentDateTime.toISOString(),
            localTime: currentDateTime.toLocaleString(),
            dayOfWeek: currentDateTime.toLocaleDateString('en-US', { weekday: 'long' })
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

        const zmanimTime = Date.now() - zmanimStartTime;

        // Parse response
        let zmanimData
        if (typeof zmanimResponse.data === 'string') {
            try {
                zmanimData = JSON.parse(zmanimResponse.data)
            } catch (e) {
                logger.error('Failed to parse zmanim response', { 
                    requestId,
                    data: zmanimResponse.data?.substring(0, 500) 
                })
                throw new Error('Invalid response from zmanim API')
            }
        } else {
            zmanimData = zmanimResponse.data
        }
        
        // Log the actual times we got
        logger.info('⏰ Zmanim times received', {
            requestId,
            responseTimeMs: zmanimTime,
            place: zmanimData.Place?.Name,
            dateFromAPI: zmanimData.Time?.DateCivil,
            dayOfWeek: zmanimData.Time?.Weekday,
            isShabbos: zmanimData.Time?.IsShabbos,
            isYomTov: zmanimData.Time?.IsYomTov,
            times: {
                sunrise: zmanimData.Zman?.SunriseDefault,
                sunset: zmanimData.Zman?.SunsetDefault,
                candles: zmanimData.Zman?.Candles,
                candles18: zmanimData.Zman?.Candles18,
                nightShabbos: zmanimData.Zman?.NightShabbos,
                night72: zmanimData.Zman?.Night72,
                shemaGra: zmanimData.Zman?.ShemaGra,
                midday: zmanimData.Zman?.Midday
            }
        })

        // Check if we need to calculate candle lighting
        let candleLightingTime = zmanimData.Zman?.Candles || zmanimData.Zman?.Candles18;
        
        if (!candleLightingTime && zmanimData.Zman?.SunsetDefault) {
            const candleMinutes = zmanimData.Place?.CandlelightingMinutes || 18;
            candleLightingTime = calculateCandleLighting(zmanimData.Zman.SunsetDefault, candleMinutes);
            
            logger.warn('⚠️ Calculated candle lighting time', {
                requestId,
                sunset: zmanimData.Zman.SunsetDefault,
                minutes: candleMinutes,
                calculated: candleLightingTime
            })
        }

        // Prepare response
        const response = {
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
                CandleLighting: candleLightingTime,
                ShabbosEnds: zmanimData.Zman?.NightShabbos || zmanimData.Zman?.Night72,
                Sunrise: zmanimData.Zman?.SunriseDefault,
                Sunset: zmanimData.Zman?.SunsetDefault,
                Tzais: zmanimData.Zman?.Night72fix,
                Tzais72: zmanimData.Zman?.Night72,
                ShachrisGRA: zmanimData.Zman?.ShemaGra,
                ShachrisMGA: zmanimData.Zman?.ShemaMA72,
                TfilaGRA: zmanimData.Zman?.ShachrisGra,
                TfilaMGA: zmanimData.Zman?.ShachrisMA72,
                Chatzos: zmanimData.Zman?.Midday,
                MinchaGedola: zmanimData.Zman?.MinchaGra,
                MinchaKetana: zmanimData.Zman?.KetanaGra,
                PlagHamincha: zmanimData.Zman?.PlagGra,
                DawnAstronomical: zmanimData.Zman?.Dawn90
            }
        }

        logger.info('✅ Zmanim response prepared', {
            requestId,
            location: `${response.location.city}, ${response.location.state}`,
            hasCandleLighting: !!response.zmanim.CandleLighting
        })

        return NextResponse.json(response)
        
    } catch (error: any) {
        logger.error('❌ Zmanim coordinates error', {
            requestId,
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            latitude,
            longitude
        })
        
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim',
            details: error.response?.data || error.message
        }, { status: 500 })
    }
}

async function getZmanimByZip(zipCode: string, requestId: string) {
    if (!zipCode) {
        logger.warn('Missing ZIP code', { requestId })
        return NextResponse.json({ error: 'ZIP code required' }, { status: 400 })
    }

    try {
        // Step 1: Search by postal code
        const searchStartTime = Date.now();
        const searchUrl = `${MYZMANIM_API.JSON_URL}/searchPostal`
        
        const formData = new URLSearchParams()
        formData.append('user', MYZMANIM_API.USER)
        formData.append('key', MYZMANIM_API.KEY)
        formData.append('coding', 'JSON')
        formData.append('query', zipCode)

        logger.info('📮 Searching postal code', { 
            requestId,
            url: searchUrl,
            zipCode
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

        const searchTime = Date.now() - searchStartTime;

        // Parse LocationID from response
        let locationId
        if (typeof searchResponse.data === 'string') {
            try {
                const parsed = JSON.parse(searchResponse.data)
                locationId = parsed.LocationID
                logger.debug('Parsed LocationID from string response', { requestId, locationId })
            } catch (e) {
                logger.error('Failed to parse postal search response', { 
                    requestId,
                    data: searchResponse.data?.substring(0, 500)
                })
                throw new Error('Invalid response from postal search')
            }
        } else {
            locationId = searchResponse.data.LocationID
        }

        if (!locationId) {
            logger.error('No LocationID found for ZIP code', { 
                requestId,
                zipCode,
                response: searchResponse.data 
            })
            throw new Error('Location not found for ZIP code')
        }

        logger.info('✅ Found LocationID for ZIP', { 
            requestId,
            zipCode,
            locationId,
            searchTimeMs: searchTime 
        })

        // Step 2: Get zmanim using LocationID
        const zmanimStartTime = Date.now();
        const zmanimUrl = `${MYZMANIM_API.JSON_URL}/getDay`
        
        // Calculate local date
        const localDate = new Date().toLocaleDateString('en-CA');
        const currentDateTime = new Date();
        
        const zmanimFormData = new URLSearchParams()
        zmanimFormData.append('user', MYZMANIM_API.USER)
        zmanimFormData.append('key', MYZMANIM_API.KEY)
        zmanimFormData.append('coding', 'JSON')
        zmanimFormData.append('language', 'en')
        zmanimFormData.append('locationid', locationId)
        zmanimFormData.append('inputdate', localDate)

        logger.info('📅 Fetching zmanim for date', { 
            requestId,
            locationId,
            inputDate: localDate,
            currentDateTime: currentDateTime.toISOString(),
            localTime: currentDateTime.toLocaleString(),
            dayOfWeek: currentDateTime.toLocaleDateString('en-US', { weekday: 'long' })
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

        const zmanimTime = Date.now() - zmanimStartTime;

        // Parse response
        let zmanimData
        if (typeof zmanimResponse.data === 'string') {
            try {
                zmanimData = JSON.parse(zmanimResponse.data)
            } catch (e) {
                logger.error('Failed to parse zmanim response', { 
                    requestId,
                    data: zmanimResponse.data?.substring(0, 500)
                })
                throw new Error('Invalid response from zmanim API')
            }
        } else {
            zmanimData = zmanimResponse.data
        }

        // Log the actual times we got
        logger.info('⏰ Zmanim times received', {
            requestId,
            responseTimeMs: zmanimTime,
            place: zmanimData.Place?.Name,
            dateFromAPI: zmanimData.Time?.DateCivil,
            dayOfWeek: zmanimData.Time?.Weekday,
            isShabbos: zmanimData.Time?.IsShabbos,
            isYomTov: zmanimData.Time?.IsYomTov,
            times: {
                sunrise: zmanimData.Zman?.SunriseDefault,
                sunset: zmanimData.Zman?.SunsetDefault,
                candles: zmanimData.Zman?.Candles,
                candles18: zmanimData.Zman?.Candles18,
                nightShabbos: zmanimData.Zman?.NightShabbos,
                night72: zmanimData.Zman?.Night72,
                shemaGra: zmanimData.Zman?.ShemaGra,
                midday: zmanimData.Zman?.Midday
            }
        })

        // Check if we need to calculate candle lighting
        let candleLightingTime = zmanimData.Zman?.Candles || zmanimData.Zman?.Candles18;
        
        if (!candleLightingTime && zmanimData.Zman?.SunsetDefault) {
            const candleMinutes = zmanimData.Place?.CandlelightingMinutes || 18;
            candleLightingTime = calculateCandleLighting(zmanimData.Zman.SunsetDefault, candleMinutes);
            
            logger.warn('⚠️ Calculated candle lighting time', {
                requestId,
                sunset: zmanimData.Zman.SunsetDefault,
                minutes: candleMinutes,
                calculated: candleLightingTime
            })
        }
        
        // Prepare response
        const response = {
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
                CandleLighting: candleLightingTime,
                ShabbosEnds: zmanimData.Zman?.NightShabbos || zmanimData.Zman?.Night72,
                Sunrise: zmanimData.Zman?.SunriseDefault,
                Sunset: zmanimData.Zman?.SunsetDefault,
                Tzais: zmanimData.Zman?.Night72fix,
                Tzais72: zmanimData.Zman?.Night72,
                ShachrisGRA: zmanimData.Zman?.ShemaGra,
                ShachrisMGA: zmanimData.Zman?.ShemaMA72,
                TfilaGRA: zmanimData.Zman?.ShachrisGra,
                TfilaMGA: zmanimData.Zman?.ShachrisMA72,
                Chatzos: zmanimData.Zman?.Midday,
                MinchaGedola: zmanimData.Zman?.MinchaGra,
                MinchaKetana: zmanimData.Zman?.KetanaGra,
                PlagHamincha: zmanimData.Zman?.PlagGra,
                DawnAstronomical: zmanimData.Zman?.Dawn90
            }
        }

        logger.info('✅ Zmanim response prepared', {
            requestId,
            zipCode,
            location: `${response.location.city}, ${response.location.state}`,
            hasCandleLighting: !!response.zmanim.CandleLighting
        })

        return NextResponse.json(response)
        
    } catch (error: any) {
        logger.error('❌ Zmanim ZIP error', {
            requestId,
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            zipCode
        })
        
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim for ZIP code',
            details: error.response?.data || error.message
        }, { status: 500 })
    }
}