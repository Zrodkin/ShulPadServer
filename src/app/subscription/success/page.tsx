'use client'

import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

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
    <div className="min-h-screen bg-green-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <div className="mx-auto w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Subscription Activated!
        </h1>
        
        <p className="text-gray-600 mb-8">
          Your ShulPad subscription is now active. You can start using the kiosk immediately.
        </p>
        
        <div className="space-y-4">
          <a
            href={`shulpad://subscription/success?org_id=${merchantId}&subscription_id=${subscriptionId}`}
            className="block w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Return to ShulPad
          </a>
          
          <p className="text-sm text-gray-500">
            You'll be redirected automatically in a few seconds...
          </p>
        </div>
      </div>
    </div>
  )
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <SuccessPageContent />
    </Suspense>
  )
}