'use client'

import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Head from 'next/head'

function SuccessPageContent() {
  const searchParams = useSearchParams()
  const merchantId = searchParams.get('merchant_id') || 'default'
  const subscriptionId = searchParams.get('subscription_id')
  
  useEffect(() => {
    // Auto-redirect to app after 3 seconds
    const timer = setTimeout(() => {
      window.location.href = `shulpad://subscription/success?merchant_id=${merchantId}&subscription_id=${subscriptionId}`
    }, 3000)
    
    return () => clearTimeout(timer)
  }, [merchantId, subscriptionId])
  
  return (
    <>
      <Head>
        <title>ShulPad Subscription - Success</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
      </Head>
      
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f0fdf4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{ maxWidth: '448px', width: '100%', textAlign: 'center' }}>
          <div style={{ marginBottom: '32px' }}>
            <div style={{
              margin: '0 auto',
              width: '64px',
              height: '64px',
              backgroundColor: '#22c55e',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg 
                style={{ width: '32px', height: '32px', color: 'white' }}
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M5 13l4 4L19 7" 
                />
              </svg>
            </div>
          </div>
          
          <h1 style={{
            fontSize: '30px',
            fontWeight: 'bold',
            color: '#111827',
            marginBottom: '16px'
          }}>
            Subscription Activated!
          </h1>
          
          <p style={{
            color: '#6b7280',
            marginBottom: '32px',
            fontSize: '16px',
            lineHeight: '1.5'
          }}>
            Your ShulPad subscription is now active. You can start using the kiosk immediately.
          </p>
          
          <div style={{ marginBottom: '16px' }}>
            <a
              href={`shulpad://subscription/success?org_id=${merchantId}&subscription_id=${subscriptionId}`}
              style={{
                display: 'block',
                width: '100%',
                padding: '12px 16px',
                backgroundColor: '#2563eb',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: '500',
                fontSize: '16px',
                transition: 'background-color 0.2s',
                border: 'none',
                cursor: 'pointer'
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1d4ed8'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
            >
              Return to ShulPad
            </a>
          </div>
          
          <p style={{
            fontSize: '14px',
            color: '#9ca3af'
          }}>
            You'll be redirected automatically in a few seconds...
          </p>
        </div>
      </div>
    </>
  )
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <>
        <Head>
          <title>ShulPad Subscription - Loading</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        </Head>
        <div style={{
          minHeight: '100vh',
          backgroundColor: '#f0fdf4',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '48px',
              height: '48px',
              border: '4px solid #bbf7d0',
              borderTop: '4px solid #22c55e',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px auto'
            }}></div>
            <p style={{ color: '#6b7280', fontSize: '16px' }}>Loading...</p>
          </div>
          <style dangerouslySetInnerHTML={{
            __html: `
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `
          }} />
        </div>
      </>
    }>
      <SuccessPageContent />
    </Suspense>
  )
}