// app/api/shabbos/test/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { logger } from "@/lib/logger"

// Test endpoint to debug MyZmanim API
export async function GET(request: NextRequest) {
    const results: any[] = []
    
    // Test 1: Simple GET request to searchGps
    try {
        const url1 = 'https://api.myzmanim.com/engine1.svc/searchGps?User=0017348426&Key=b39acded156d0d01696651265ab3c6bb523934acc8c5fe5774db5e25cce79f8e0fab3eff48acfdc0&Coding=JSON&Latitude=37.785834&Longitude=-122.406417'
        const response1 = await axios.get(url1, {
            headers: {
                'Accept': 'application/json'
            },
            timeout: 10000
        })
        results.push({
            test: 'GET searchGps',
            status: response1.status,
            data: response1.data,
            success: true
        })
    } catch (error: any) {
        results.push({
            test: 'GET searchGps',
            error: error.message,
            status: error.response?.status,
            data: error.response?.data,
            success: false
        })
    }
    
    // Test 2: Try the JSON endpoint directly
    try {
        const url2 = 'https://api.myzmanim.com/engine1.json.aspx?coding=JSON&language=en&latitude=37.785834&longitude=-122.406417&key=b39acded156d0d01696651265ab3c6bb523934acc8c5fe5774db5e25cce79f8e0fab3eff48acfdc0&user=0017348426&inputdate=' + new Date().toISOString().split('T')[0]
        const response2 = await axios.get(url2, {
            headers: {
                'Accept': 'application/json'
            },
            timeout: 10000
        })
        results.push({
            test: 'JSON endpoint direct',
            status: response2.status,
            data: response2.data,
            success: true
        })
    } catch (error: any) {
        results.push({
            test: 'JSON endpoint direct',
            error: error.message,
            status: error.response?.status,
            data: error.response?.data,
            success: false
        })
    }
    
    // Test 3: Try with a known LocationID (if we have one)
    try {
        const url3 = 'https://api.myzmanim.com/engine1.svc/getDay?User=0017348426&Key=b39acded156d0d01696651265ab3c6bb523934acc8c5fe5774db5e25cce79f8e0fab3eff48acfdc0&Coding=JSON&Language=en&LocationId=32383&InputDate=' + new Date().toISOString().split('T')[0]
        const response3 = await axios.get(url3, {
            headers: {
                'Accept': 'application/json'
            },
            timeout: 10000
        })
        results.push({
            test: 'GET getDay with known LocationID',
            status: response3.status,
            data: response3.data,
            success: true
        })
    } catch (error: any) {
        results.push({
            test: 'GET getDay with known LocationID',
            error: error.message,
            status: error.response?.status,
            data: error.response?.data,
            success: false
        })
    }
    
    logger.info('MyZmanim API Test Results', results)
    
    return NextResponse.json({
        message: 'MyZmanim API Tests Complete',
        results: results,
        summary: {
            total: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        }
    })
}

// Alternative simpler endpoint for the iOS app to use temporarily
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { action, latitude, longitude } = body
        
        if (action !== 'coordinates') {
            return NextResponse.json({ error: 'Only coordinates action supported in test' }, { status: 400 })
        }
        
        logger.info('Test endpoint called with coordinates', { latitude, longitude })
        
        // For now, return mock data so the app doesn't crash
        // This will help you continue development while we fix the API issue
        return NextResponse.json({
            success: true,
            locationId: 'test-location',
            location: {
                name: 'San Francisco',
                city: 'San Francisco',
                state: 'CA'
            },
            date: new Date().toISOString().split('T')[0],
            isShabbos: false,
            isYomTov: false,
            zmanim: {
                CandleLighting: '18:30',
                ShabbosEnds: '19:30',
                Sunrise: '06:30',
                Sunset: '18:48',
                Tzais: '19:20',
                Tzais72: '19:50',
                ShachrisGRA: '09:00',
                ShachrisMGA: '08:30',
                Chatzos: '12:30',
                MinchaGedola: '13:00',
                MinchaKetana: '16:00',
                PlagHamincha: '17:15'
            }
        })
    } catch (error: any) {
        logger.error('Test endpoint error:', error.message)
        return NextResponse.json({
            success: false,
            error: 'Test endpoint error',
            details: error.message
        }, { status: 500 })
    }
}