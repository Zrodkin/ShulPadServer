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

// Comprehensive type definitions for all API fields
interface PlaceData {
    LocationID?: string;
    Name?: string;
    NameShort?: string;
    Country?: string;
    State?: string;
    County?: string;
    City?: string;
    PostalCode?: string;
    DavenDirectionGC?: number;
    DavenDirectionRL?: number;
    CandlelightingMinutes?: number;
    YakirDegreesDefault?: number;
    ElevationObserver?: number;
    ElevationWest?: number;
    ElevationEast?: number;
    ObservesDST?: string;
    AirportCode?: string;
    CityHebrew?: string;
}

interface TimeData {
    DateCivil?: string;
    DateCivilLong?: string;
    DateJewish?: string;
    DateJewishLong?: string;
    DateJewishShort?: string;
    DateFullLong?: string;
    DateFullShort?: string;
    DateSemiLong?: string;
    DateSemiShort?: string;
    Weekday?: string;
    WeekdayShort?: string;
    Omer?: number;
    DafYomiTract?: string;
    DafYomiPage?: string;
    DafYomi?: string;
    DaylightTime?: number;
    Parsha?: string;
    ParshaShort?: string;
    Holiday?: string;
    HolidayShort?: string | null;
    ParshaAndHoliday?: string;
    TomorrowParsha?: string;
    TomorrowParshaOrHoliday?: string;
    
    // Boolean flags
    IsShabbos?: boolean;
    IsYomTov?: boolean;
    IsCholHamoed?: boolean;
    IsYomKipper?: boolean;
    IsTishaBav?: boolean;
    IsErevTishaBav?: boolean;
    IsShivaAsarBitammuz?: boolean;
    IsTaanisEsther?: boolean;
    IsTzomGedalia?: boolean;
    IsAsaraBiteves?: boolean;
    IsFastDay?: boolean;
    IsErevPesach?: boolean;
    IsRoshChodesh?: boolean;
    IsTuBeshvat?: boolean;
    IsErevShabbos?: boolean;
    IsErevYomTov?: boolean;
    IsErevYomKipper?: boolean;
    TonightIsYomTov?: boolean;
    TomorrowNightIsYomTov?: boolean;
}

interface ZmanData {
    // Dawn times
    Dawn90?: string;
    Dawn72?: string;
    Dawn72fix?: string;
    DawnRMF?: string;
    
    // Yakir (earliest tallis/tefillin)
    Yakir115?: string;
    Yakir110?: string;
    Yakir102?: string;
    YakirDefault?: string;
    
    // Sunrise variations
    SunriseLevel?: string;
    SunriseElevated?: string;
    SunriseDefault?: string;
    
    // Shema times - different opinions
    ShemaBenIsh90ToFastTuc?: string;
    ShemaBenIsh72ToFastTuc?: string;
    ShemaBenIsh72ToShabbos?: string;
    ShemaMA90?: string;
    ShemaMA72?: string;
    ShemaMA72fix?: string;
    ShemaGra?: string;
    ShemaRMF?: string;
    
    // Shachris (Tefillah) times
    ShachrisMA90?: string;
    ShachrisMA72?: string;
    ShachrisMA72fix?: string;
    ShachrisGra?: string;
    ShachrisRMF?: string;
    
    // Midday
    Midday?: string;
    MiddayRMF?: string;
    
    // Mincha times
    MinchaGra?: string;
    Mincha30fix?: string;
    MinchaMA72fix?: string;
    MinchaStrict?: string;
    
    // Mincha Ketana
    KetanaGra?: string;
    KetanaMA72fix?: string;
    
    // Plag HaMincha
    PlagGra?: string;
    PlagMA72fix?: string;
    PlagBenIsh90ToFastTuc?: string;
    PlagBenIsh72ToFastTuc?: string;
    PlagBenIsh72ToShabbos?: string;
    
    // Sunset variations
    SunsetLevel?: string;
    SunsetElevated?: string;
    SunsetDefault?: string;
    
    // Night/Tzais times
    NightGra180?: string;
    NightGra225?: string;
    NightGra240?: string;
    NightZalman?: string;
    NightFastTuc?: string;
    NightFastRMF?: string;
    NightMoed?: string;
    NightShabbos?: string;
    NightChazonIsh?: string;
    Night50fix?: string;
    Night60fix?: string;
    Night72?: string;
    Night72fix?: string;
    Night72fixLevel?: string;
    Night90?: string;
    
    // Midnight
    Midnight?: string;
    
    // Chametz times (for Pesach)
    ChametzEatGra?: string;
    ChametzEatMA72?: string;
    ChametzEatMA72fix?: string;
    ChametzEatRMF?: string;
    ChametzBurnGra?: string;
    ChametzBurnMA72?: string;
    ChametzBurnMA72fix?: string;
    ChametzBurnRMF?: string;
    
    // Tomorrow's times
    TomorrowNightShabbos?: string;
    TomorrowSunriseLevel?: string;
    TomorrowSunriseElevated?: string;
    TomorrowSunriseDefault?: string;
    TomorrowSunsetLevel?: string;
    TomorrowSunsetElevated?: string;
    TomorrowSunsetDefault?: string;
    TomorrowNight72fix?: string;
    TomorrowNightChazonIsh?: string;
    Tomorrow2NightShabbos?: string;
    Tomorrow2SunsetLevel?: string;
    Tomorrow2SunsetElevated?: string;
    Tomorrow2SunsetDefault?: string;
    Tomorrow2Night72fix?: string;
    Tomorrow2NightChazonIsh?: string;
    
    // Proportional times (for calculations)
    PropGra?: number;
    PropMA72?: number;
    PropMA72fix?: number;
    PropMA90?: number;
    PropRmfMorning?: number;
    PropBenIsh90ToFastTuc?: number;
    PropBenIsh72ToFastTuc?: number;
    PropBenIsh72ToShabbos?: number;
    
    // Candle lighting (may be calculated or provided)
    Candles?: string;
    Candles18?: string;
    Candles20?: string;
    Candles22?: string;
    Candles30?: string;
    Candles40?: string;
}

// Complete API Response
interface MyZmanimAPIResponse {
    Place?: PlaceData;
    Time?: TimeData;
    Zman?: ZmanData;
}

// Our structured response for backward compatibility
interface FormattedZmanim {
    // Essential Shabbos times
    candleLighting: {
        standard18: string | null;
        minutes20: string | null;
        minutes22: string | null;
        minutes30: string | null;
        minutes40: string | null;
    };
    
    shabbosEnds: {
        nightShabbos: string | null;
        night50: string | null;
        night60: string | null;
        night72: string | null;
        night72fix: string | null;
        night90: string | null;
        nightChazonIsh: string | null;
        nightRavMoshe: string | null;
    };
    
    // Dawn times
    dawn: {
        alot90: string | null;
        alot72: string | null;
        alot72fix: string | null;
        alotRavMoshe: string | null;
        yakir115: string | null;
        yakir110: string | null;
        yakir102: string | null;
        yakirDefault: string | null;
    };
    
    // Core daily times
    sunrise: {
        level: string | null;
        elevated: string | null;
        default: string | null;
    };
    
    sunset: {
        level: string | null;
        elevated: string | null;
        default: string | null;
    };
    
    // Shema times by opinion
    shema: {
        gra: string | null;
        ma72: string | null;
        ma72fix: string | null;
        ma90: string | null;
        ravMoshe: string | null;
        benIshChai90: string | null;
        benIshChai72: string | null;
        benIshChaiShabbos: string | null;
    };
    
    // Tefillah times by opinion
    tefillah: {
        gra: string | null;
        ma72: string | null;
        ma72fix: string | null;
        ma90: string | null;
        ravMoshe: string | null;
    };
    
    // Midday
    chatzos: {
        standard: string | null;
        ravMoshe: string | null;
    };
    
    // Mincha times
    mincha: {
        gedolaGra: string | null;
        gedola30: string | null;
        gedolaMA72: string | null;
        strict: string | null;
        ketanaGra: string | null;
        ketanaMA72: string | null;
    };
    
    // Plag HaMincha
    plagHamincha: {
        gra: string | null;
        ma72fix: string | null;
        benIshChai90: string | null;
        benIshChai72: string | null;
        benIshChaiShabbos: string | null;
    };
    
    // Chametz times (relevant during Pesach)
    chametz: {
        eatGra: string | null;
        eatMA72: string | null;
        eatMA72fix: string | null;
        eatRavMoshe: string | null;
        burnGra: string | null;
        burnMA72: string | null;
        burnMA72fix: string | null;
        burnRavMoshe: string | null;
    };
    
    // Tomorrow's key times
    tomorrow: {
        sunrise: string | null;
        sunset: string | null;
        nightShabbos: string | null;
        night72fix: string | null;
        nightChazonIsh: string | null;
    };
    
    // Proportional hour lengths (in minutes)
    proportionalHours: {
        shaahZmanisGra: number | null;
        shaahZmanisMA72: number | null;
        shaahZmanisMA72fix: number | null;
        shaahZmanisMA90: number | null;
    };
}

// Helper function to safely extract string value
function safeString(value: any): string | null {
    return value && typeof value === 'string' ? value : null;
}

// Helper function to safely extract number value
function safeNumber(value: any): number | null {
    return value && typeof value === 'number' ? value : null;
}

// Format the zmanim into structured categories
function formatZmanim(zman: ZmanData | undefined): FormattedZmanim {
    if (!zman) {
        return createEmptyFormattedZmanim();
    }
    
    return {
        candleLighting: {
            standard18: safeString(zman.Candles18 || zman.Candles),
            minutes20: safeString(zman.Candles20),
            minutes22: safeString(zman.Candles22),
            minutes30: safeString(zman.Candles30),
            minutes40: safeString(zman.Candles40)
        },
        
        shabbosEnds: {
            nightShabbos: safeString(zman.NightShabbos),
            night50: safeString(zman.Night50fix),
            night60: safeString(zman.Night60fix),
            night72: safeString(zman.Night72),
            night72fix: safeString(zman.Night72fix),
            night90: safeString(zman.Night90),
            nightChazonIsh: safeString(zman.NightChazonIsh),
            nightRavMoshe: safeString(zman.NightFastRMF)
        },
        
        dawn: {
            alot90: safeString(zman.Dawn90),
            alot72: safeString(zman.Dawn72),
            alot72fix: safeString(zman.Dawn72fix),
            alotRavMoshe: safeString(zman.DawnRMF),
            yakir115: safeString(zman.Yakir115),
            yakir110: safeString(zman.Yakir110),
            yakir102: safeString(zman.Yakir102),
            yakirDefault: safeString(zman.YakirDefault)
        },
        
        sunrise: {
            level: safeString(zman.SunriseLevel),
            elevated: safeString(zman.SunriseElevated),
            default: safeString(zman.SunriseDefault)
        },
        
        sunset: {
            level: safeString(zman.SunsetLevel),
            elevated: safeString(zman.SunsetElevated),
            default: safeString(zman.SunsetDefault)
        },
        
        shema: {
            gra: safeString(zman.ShemaGra),
            ma72: safeString(zman.ShemaMA72),
            ma72fix: safeString(zman.ShemaMA72fix),
            ma90: safeString(zman.ShemaMA90),
            ravMoshe: safeString(zman.ShemaRMF),
            benIshChai90: safeString(zman.ShemaBenIsh90ToFastTuc),
            benIshChai72: safeString(zman.ShemaBenIsh72ToFastTuc),
            benIshChaiShabbos: safeString(zman.ShemaBenIsh72ToShabbos)
        },
        
        tefillah: {
            gra: safeString(zman.ShachrisGra),
            ma72: safeString(zman.ShachrisMA72),
            ma72fix: safeString(zman.ShachrisMA72fix),
            ma90: safeString(zman.ShachrisMA90),
            ravMoshe: safeString(zman.ShachrisRMF)
        },
        
        chatzos: {
            standard: safeString(zman.Midday),
            ravMoshe: safeString(zman.MiddayRMF)
        },
        
        mincha: {
            gedolaGra: safeString(zman.MinchaGra),
            gedola30: safeString(zman.Mincha30fix),
            gedolaMA72: safeString(zman.MinchaMA72fix),
            strict: safeString(zman.MinchaStrict),
            ketanaGra: safeString(zman.KetanaGra),
            ketanaMA72: safeString(zman.KetanaMA72fix)
        },
        
        plagHamincha: {
            gra: safeString(zman.PlagGra),
            ma72fix: safeString(zman.PlagMA72fix),
            benIshChai90: safeString(zman.PlagBenIsh90ToFastTuc),
            benIshChai72: safeString(zman.PlagBenIsh72ToFastTuc),
            benIshChaiShabbos: safeString(zman.PlagBenIsh72ToShabbos)
        },
        
        chametz: {
            eatGra: safeString(zman.ChametzEatGra),
            eatMA72: safeString(zman.ChametzEatMA72),
            eatMA72fix: safeString(zman.ChametzEatMA72fix),
            eatRavMoshe: safeString(zman.ChametzEatRMF),
            burnGra: safeString(zman.ChametzBurnGra),
            burnMA72: safeString(zman.ChametzBurnMA72),
            burnMA72fix: safeString(zman.ChametzBurnMA72fix),
            burnRavMoshe: safeString(zman.ChametzBurnRMF)
        },
        
        tomorrow: {
            sunrise: safeString(zman.TomorrowSunriseDefault),
            sunset: safeString(zman.TomorrowSunsetDefault),
            nightShabbos: safeString(zman.TomorrowNightShabbos),
            night72fix: safeString(zman.TomorrowNight72fix),
            nightChazonIsh: safeString(zman.TomorrowNightChazonIsh)
        },
        
        proportionalHours: {
            shaahZmanisGra: safeNumber(zman.PropGra),
            shaahZmanisMA72: safeNumber(zman.PropMA72),
            shaahZmanisMA72fix: safeNumber(zman.PropMA72fix),
            shaahZmanisMA90: safeNumber(zman.PropMA90)
        }
    };
}

function createEmptyFormattedZmanim(): FormattedZmanim {
    return {
        candleLighting: {
            standard18: null,
            minutes20: null,
            minutes22: null,
            minutes30: null,
            minutes40: null
        },
        shabbosEnds: {
            nightShabbos: null,
            night50: null,
            night60: null,
            night72: null,
            night72fix: null,
            night90: null,
            nightChazonIsh: null,
            nightRavMoshe: null
        },
        dawn: {
            alot90: null,
            alot72: null,
            alot72fix: null,
            alotRavMoshe: null,
            yakir115: null,
            yakir110: null,
            yakir102: null,
            yakirDefault: null
        },
        sunrise: {
            level: null,
            elevated: null,
            default: null
        },
        sunset: {
            level: null,
            elevated: null,
            default: null
        },
        shema: {
            gra: null,
            ma72: null,
            ma72fix: null,
            ma90: null,
            ravMoshe: null,
            benIshChai90: null,
            benIshChai72: null,
            benIshChaiShabbos: null
        },
        tefillah: {
            gra: null,
            ma72: null,
            ma72fix: null,
            ma90: null,
            ravMoshe: null
        },
        chatzos: {
            standard: null,
            ravMoshe: null
        },
        mincha: {
            gedolaGra: null,
            gedola30: null,
            gedolaMA72: null,
            strict: null,
            ketanaGra: null,
            ketanaMA72: null
        },
        plagHamincha: {
            gra: null,
            ma72fix: null,
            benIshChai90: null,
            benIshChai72: null,
            benIshChaiShabbos: null
        },
        chametz: {
            eatGra: null,
            eatMA72: null,
            eatMA72fix: null,
            eatRavMoshe: null,
            burnGra: null,
            burnMA72: null,
            burnMA72fix: null,
            burnRavMoshe: null
        },
        tomorrow: {
            sunrise: null,
            sunset: null,
            nightShabbos: null,
            night72fix: null,
            nightChazonIsh: null
        },
        proportionalHours: {
            shaahZmanisGra: null,
            shaahZmanisMA72: null,
            shaahZmanisMA72fix: null,
            shaahZmanisMA90: null
        }
    };
}

// Main POST endpoint
export async function POST(request: NextRequest) {
    const requestId = Math.random().toString(36).substring(7);
    const startTime = Date.now();
    
    try {
        const body = await request.json()
        const { action, latitude, longitude, zipCode, date } = body
        
        logger.info('🔵 Comprehensive Shabbos API Request', { 
            requestId,
            action, 
            latitude, 
            longitude, 
            zipCode,
            date,
            timestamp: new Date().toISOString()
        })
        
        // Route based on action
        let result;
        if (action === 'coordinates') {
            result = await getZmanimByCoordinates(latitude, longitude, date, requestId)
        } else if (action === 'zip') {
            result = await getZmanimByZip(zipCode, date, requestId)
        } else {
            logger.warn('Invalid action provided', { requestId, action })
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
        }
        
        const totalTime = Date.now() - startTime;
        logger.info('🟢 Shabbos API Request Completed', { 
            requestId,
            totalTimeMs: totalTime
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

async function getZmanimByCoordinates(
    latitude: number, 
    longitude: number, 
    inputDate?: string,
    requestId?: string
) {
    if (!latitude || !longitude) {
        return NextResponse.json({ error: 'Latitude and longitude required' }, { status: 400 })
    }

    try {
        // Step 1: Search for LocationID using GPS coordinates
        const searchUrl = `${MYZMANIM_API.JSON_URL}/searchGps`
        
        const formData = new URLSearchParams()
        formData.append('user', MYZMANIM_API.USER)
        formData.append('key', MYZMANIM_API.KEY)
        formData.append('coding', 'JSON')
        formData.append('latitude', latitude.toString())
        formData.append('longitude', longitude.toString())

        logger.info('📍 Searching GPS coordinates', { 
            requestId,
            latitude,
            longitude
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

        // Parse LocationID from response
        let locationId
        if (typeof searchResponse.data === 'string') {
            try {
                const parsed = JSON.parse(searchResponse.data)
                locationId = parsed.LocationID
            } catch (e) {
                logger.error('Failed to parse GPS search response', { 
                    requestId,
                    data: searchResponse.data 
                })
                throw new Error('Invalid response from GPS search')
            }
        } else {
            locationId = searchResponse.data.LocationID
        }

        if (!locationId) {
            throw new Error('Location not found for coordinates')
        }

        logger.info('✅ Found LocationID', { 
            requestId,
            locationId 
        })

        // Step 2: Get comprehensive zmanim data
        return await fetchZmanimData(locationId, inputDate, requestId)
        
    } catch (error: any) {
        logger.error('GPS coordinates error:', {
            requestId,
            message: error.message,
            response: error.response?.data
        })
        
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim',
            details: error.response?.data || error.message
        }, { status: 500 })
    }
}

async function getZmanimByZip(
    zipCode: string, 
    inputDate?: string,
    requestId?: string
) {
    if (!zipCode) {
        return NextResponse.json({ error: 'ZIP code required' }, { status: 400 })
    }

    try {
        // Step 1: Search by postal code
        const searchUrl = `${MYZMANIM_API.JSON_URL}/searchPostal`
        
        const formData = new URLSearchParams()
        formData.append('user', MYZMANIM_API.USER)
        formData.append('key', MYZMANIM_API.KEY)
        formData.append('coding', 'JSON')
        formData.append('query', zipCode)

        logger.info('📮 Searching postal code', { 
            requestId,
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

        // Parse LocationID from response
        let locationId
        if (typeof searchResponse.data === 'string') {
            try {
                const parsed = JSON.parse(searchResponse.data)
                locationId = parsed.LocationID
            } catch (e) {
                logger.error('Failed to parse postal search response', { 
                    requestId,
                    data: searchResponse.data 
                })
                throw new Error('Invalid response from postal search')
            }
        } else {
            locationId = searchResponse.data.LocationID
        }

        if (!locationId) {
            throw new Error('Location not found for ZIP code')
        }

        logger.info('✅ Found LocationID for ZIP', { 
            requestId,
            zipCode,
            locationId
        })

        // Step 2: Get comprehensive zmanim data
        return await fetchZmanimData(locationId, inputDate, requestId, zipCode)
        
    } catch (error: any) {
        logger.error('ZIP code error:', {
            requestId,
            message: error.message,
            response: error.response?.data
        })
        
        return NextResponse.json({
            success: false,
            error: 'Failed to fetch zmanim for ZIP code',
            details: error.response?.data || error.message
        }, { status: 500 })
    }
}

async function fetchZmanimData(
    locationId: string, 
    inputDate?: string, 
    requestId?: string,
    zipCode?: string
) {
    const zmanimUrl = `${MYZMANIM_API.JSON_URL}/getDay`
    
    // Use provided date or today's date
    const dateToUse = inputDate || new Date().toISOString().split('T')[0]
    
    const zmanimFormData = new URLSearchParams()
    zmanimFormData.append('user', MYZMANIM_API.USER)
    zmanimFormData.append('key', MYZMANIM_API.KEY)
    zmanimFormData.append('coding', 'JSON')
    zmanimFormData.append('language', 'en')
    zmanimFormData.append('locationid', locationId)
    zmanimFormData.append('inputdate', dateToUse)

    logger.info('📅 Fetching comprehensive zmanim', { 
        requestId,
        locationId,
        inputDate: dateToUse
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

    // Parse response
    let zmanimData: MyZmanimAPIResponse
    if (typeof zmanimResponse.data === 'string') {
        try {
            zmanimData = JSON.parse(zmanimResponse.data)
        } catch (e) {
            logger.error('Failed to parse zmanim response', { 
                requestId,
                data: zmanimResponse.data 
            })
            throw new Error('Invalid response from zmanim API')
        }
    } else {
        zmanimData = zmanimResponse.data
    }
    
    // Log available fields for debugging
    if (zmanimData.Zman) {
        const availableFields = Object.keys(zmanimData.Zman).filter(key => zmanimData.Zman![key as keyof ZmanData] !== null)
        logger.info('📊 Available Zman fields', {
            requestId,
            count: availableFields.length,
            fields: availableFields.slice(0, 10), // Log first 10 for brevity
            sampleValues: {
                sunrise: zmanimData.Zman.SunriseDefault,
                sunset: zmanimData.Zman.SunsetDefault,
                shabbosEnds: zmanimData.Zman.NightShabbos
            }
        })
    }
    
    // Build comprehensive response
    return NextResponse.json({
        success: true,
        locationId: locationId,
        
        // Location information
        location: {
            name: zmanimData.Place?.Name,
            nameShort: zmanimData.Place?.NameShort,
            city: zmanimData.Place?.City,
            state: zmanimData.Place?.State,
            country: zmanimData.Place?.Country,
            county: zmanimData.Place?.County,
            zipCode: zmanimData.Place?.PostalCode || zipCode,
            airportCode: zmanimData.Place?.AirportCode,
            cityHebrew: zmanimData.Place?.CityHebrew,
            elevation: {
                observer: zmanimData.Place?.ElevationObserver,
                west: zmanimData.Place?.ElevationWest,
                east: zmanimData.Place?.ElevationEast
            },
            settings: {
                candlelightingMinutes: zmanimData.Place?.CandlelightingMinutes,
                yakirDegreesDefault: zmanimData.Place?.YakirDegreesDefault,
                observesDST: zmanimData.Place?.ObservesDST === 'Yes'
            },
            direction: {
                davenGC: zmanimData.Place?.DavenDirectionGC,
                davenRL: zmanimData.Place?.DavenDirectionRL
            }
        },
        
        // Date and time information
        dateInfo: {
            civil: {
                date: zmanimData.Time?.DateCivil,
                dateLong: zmanimData.Time?.DateCivilLong,
                weekday: zmanimData.Time?.Weekday,
                weekdayShort: zmanimData.Time?.WeekdayShort
            },
            jewish: {
                date: zmanimData.Time?.DateJewish,
                dateLong: zmanimData.Time?.DateJewishLong,
                dateShort: zmanimData.Time?.DateJewishShort
            },
            combined: {
                fullLong: zmanimData.Time?.DateFullLong,
                fullShort: zmanimData.Time?.DateFullShort,
                semiLong: zmanimData.Time?.DateSemiLong,
                semiShort: zmanimData.Time?.DateSemiShort
            },
            torah: {
                parsha: zmanimData.Time?.Parsha,
                parshaShort: zmanimData.Time?.ParshaShort,
                holiday: zmanimData.Time?.Holiday,
                holidayShort: zmanimData.Time?.HolidayShort,
                parshaAndHoliday: zmanimData.Time?.ParshaAndHoliday,
                tomorrowParsha: zmanimData.Time?.TomorrowParsha,
                tomorrowParshaOrHoliday: zmanimData.Time?.TomorrowParshaOrHoliday,
                omer: zmanimData.Time?.Omer,
                dafYomi: {
                    tract: zmanimData.Time?.DafYomiTract,
                    page: zmanimData.Time?.DafYomiPage,
                    full: zmanimData.Time?.DafYomi
                }
            },
            isDST: zmanimData.Time?.DaylightTime === 1
        },
        
        // Halachic status flags
        status: {
            isShabbos: zmanimData.Time?.IsShabbos || false,
            isYomTov: zmanimData.Time?.IsYomTov || false,
            isCholHamoed: zmanimData.Time?.IsCholHamoed || false,
            isYomKipper: zmanimData.Time?.IsYomKipper || false,
            isTishaBav: zmanimData.Time?.IsTishaBav || false,
            isErevTishaBav: zmanimData.Time?.IsErevTishaBav || false,
            isShivaAsarBitammuz: zmanimData.Time?.IsShivaAsarBitammuz || false,
            isTaanisEsther: zmanimData.Time?.IsTaanisEsther || false,
            isTzomGedalia: zmanimData.Time?.IsTzomGedalia || false,
            isAsaraBiteves: zmanimData.Time?.IsAsaraBiteves || false,
            isFastDay: zmanimData.Time?.IsFastDay || false,
            isErevPesach: zmanimData.Time?.IsErevPesach || false,
            isRoshChodesh: zmanimData.Time?.IsRoshChodesh || false,
            isTuBeshvat: zmanimData.Time?.IsTuBeshvat || false,
            isErevShabbos: zmanimData.Time?.IsErevShabbos || false,
            isErevYomTov: zmanimData.Time?.IsErevYomTov || false,
            isErevYomKipper: zmanimData.Time?.IsErevYomKipper || false,
            tonightIsYomTov: zmanimData.Time?.TonightIsYomTov || false,
            tomorrowNightIsYomTov: zmanimData.Time?.TomorrowNightIsYomTov || false
        },
        
        // Formatted zmanim (organized by category)
        zmanim: formatZmanim(zmanimData.Zman),
        
        // Raw zmanim data (all fields as received from API)
        rawZmanim: zmanimData.Zman || {},
        
        // Legacy format for backward compatibility
        legacyFormat: {
            CandleLighting: zmanimData.Zman?.Candles || zmanimData.Zman?.Candles18,
            ShabbosEnds: zmanimData.Zman?.NightShabbos,
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
    })
}