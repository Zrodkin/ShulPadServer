// app/api/shabbos/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { logger } from "@/lib/logger"
import { 
    ComplexZmanimCalendar, 
    GeoLocation, 
    JewishCalendar,
    JewishDate,
    getZmanimJson
} from "kosher-zmanim"
import { find } from 'geo-tz'

// Helper function to format date to ISO string
function formatDateToISO(date: Date | null): string | null {
    if (!date) return null
    return date.toISOString()
}

// Helper function to get Friday's date for candle lighting
function getUpcomingFriday(): Date {
    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7
    const friday = new Date(today)
    friday.setDate(today.getDate() + daysUntilFriday)
    return friday
}

// Helper function to get Saturday's date for Shabbos end
function getUpcomingSaturday(): Date {
    const today = new Date()
    const dayOfWeek = today.getDay()
    const daysUntilSaturday = (6 - dayOfWeek + 7) % 7 || 7
    const saturday = new Date(today)
    saturday.setDate(today.getDate() + daysUntilSaturday)
    return saturday
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { action, latitude, longitude, zipCode } = body
        
        logger.info('Shabbos API called', { action, latitude, longitude, zipCode })
        
        if (action === 'coordinates') {
            return await getZmanimByCoordinates(latitude, longitude)
        } else if (action === 'zip') {
            // For ZIP codes, you'll need to convert to lat/long first
            // You can use a geocoding service or maintain a ZIP database
            return NextResponse.json({ 
                error: 'ZIP code lookup requires geocoding service setup' 
            }, { status: 501 })
        } else {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
        }
    } catch (error: any) {
        logger.error('Zmanim API Error:', error.message)
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim',
            details: error.message
        }, { status: 500 })
    }
}

async function getZmanimByCoordinates(latitude: number, longitude: number) {
    if (!latitude || !longitude) {
        return NextResponse.json({ error: 'Latitude and longitude required' }, { status: 400 })
    }

    try {
        // Get timezone from coordinates
        const timezone = find(latitude, longitude)[0] || 'UTC'
        
        // Create GeoLocation with proper timezone
        const geoLocation = new GeoLocation(
            "Current Location",
            latitude,
            longitude,
            0, // elevation in meters (optional)
            timezone
        )

        // Get today's date for regular zmanim
        const today = new Date()
        const zmanimCalendar = new ComplexZmanimCalendar(geoLocation)
        zmanimCalendar.setDate(today)

        // Get Friday for candle lighting
        const friday = getUpcomingFriday()
        const fridayCalendar = new ComplexZmanimCalendar(geoLocation)
        fridayCalendar.setDate(friday)

        // Get Saturday for Shabbos end
        const saturday = getUpcomingSaturday()
        const saturdayCalendar = new ComplexZmanimCalendar(geoLocation)
        saturdayCalendar.setDate(saturday)

        // Check if today is actually Shabbos
        const jewishCalendar = new JewishCalendar()
        const isCurrentlyShabbos = jewishCalendar.getDayOfWeek() === 7 // Saturday
        const isYomTov = jewishCalendar.isYomTov()

        // Build response matching your existing format
        const response = {
            success: true,
            locationId: `${latitude},${longitude}`, // Use coordinates as ID
            location: {
                name: "Current Location",
                city: null, // Would need geocoding service for city name
                state: null, // Would need geocoding service for state
                zipCode: null
            },
            date: today.toISOString().split('T')[0],
            isShabbos: isCurrentlyShabbos,
            isYomTov: isYomTov,
            zmanim: {
                // Shabbos times (from Friday/Saturday calendars)
                CandleLighting: formatDateToISO(fridayCalendar.getCandleLighting()),
                ShabbosEnds: formatDateToISO(saturdayCalendar.getTzais72()),
                
                // Today's zmanim
                Sunrise: formatDateToISO(zmanimCalendar.getSunrise()),
                Sunset: formatDateToISO(zmanimCalendar.getSunset()),
                Tzais: formatDateToISO(zmanimCalendar.getTzais()),
                Tzais72: formatDateToISO(zmanimCalendar.getTzais72()),
                
                // Shema and Tefila times
                ShachrisGRA: formatDateToISO(zmanimCalendar.getSofZmanShmaGRA()),
                ShachrisMGA: formatDateToISO(zmanimCalendar.getSofZmanShmaMGA()),
                TfilaGRA: formatDateToISO(zmanimCalendar.getSofZmanTfilaGRA()),
                TfilaMGA: formatDateToISO(zmanimCalendar.getSofZmanTfilaMGA()),
                
                // Other daily zmanim
                Chatzos: formatDateToISO(zmanimCalendar.getChatzos()),
                MinchaGedola: formatDateToISO(zmanimCalendar.getMinchaGedola(
                    zmanimCalendar.getSunrise(), 
                    zmanimCalendar.getSunset()
                )),
                MinchaKetana: formatDateToISO(zmanimCalendar.getMinchaKetana(
                    zmanimCalendar.getSunrise(), 
                    zmanimCalendar.getSunset()
                )),
                PlagHamincha: formatDateToISO(zmanimCalendar.getPlagHamincha(
                    zmanimCalendar.getSunrise(), 
                    zmanimCalendar.getSunset()
                )),
                DawnAstronomical: formatDateToISO(zmanimCalendar.getAlos72()) // Alot Hashachar
            }
        }

        logger.info('Zmanim calculated successfully', {
            latitude,
            longitude,
            candleLighting: response.zmanim.CandleLighting,
            shabbosEnds: response.zmanim.ShabbosEnds
        })

        return NextResponse.json(response)
        
    } catch (error: any) {
        logger.error('Zmanim calculation error:', {
            message: error.message,
            stack: error.stack
        })
        
        return NextResponse.json({
            success: false,
            error: 'Failed to calculate zmanim',
            details: error.message
        }, { status: 500 })
    }
}