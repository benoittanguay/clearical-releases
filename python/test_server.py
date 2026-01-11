#!/usr/bin/env python3
"""
Test script for FastVLM Inference Server

This script tests the server endpoints and provides example usage.

Usage:
    python test_server.py [--host HOST] [--port PORT] [--image IMAGE_PATH]
"""

import argparse
import sys
import json
import base64
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: requests library not installed")
    print("Install with: pip install requests")
    sys.exit(1)


def test_root(base_url: str):
    """Test the root endpoint."""
    print("\n" + "="*60)
    print("Testing GET / (Server Info)")
    print("="*60)

    try:
        response = requests.get(f"{base_url}/")
        response.raise_for_status()

        data = response.json()
        print("✓ Server Info:")
        print(f"  Name: {data['name']}")
        print(f"  Version: {data['version']}")
        print(f"  Model: {data['model']['model_name']}")
        print(f"  Loaded: {data['model']['loaded']}")

        return True
    except Exception as e:
        print(f"✗ Failed: {str(e)}")
        return False


def test_health(base_url: str):
    """Test the health endpoint."""
    print("\n" + "="*60)
    print("Testing GET /health")
    print("="*60)

    try:
        response = requests.get(f"{base_url}/health")
        response.raise_for_status()

        data = response.json()
        print(f"✓ Health Check:")
        print(f"  Status: {data['status']}")
        print(f"  Model Loaded: {data['model_loaded']}")

        if data['status'] != 'healthy':
            print("  Warning: Server is not healthy!")
            return False

        return True
    except Exception as e:
        print(f"✗ Failed: {str(e)}")
        return False


def test_analyze_path(base_url: str, image_path: str):
    """Test the analyze endpoint with a file path."""
    print("\n" + "="*60)
    print("Testing POST /analyze (with image_path)")
    print("="*60)

    if not Path(image_path).exists():
        print(f"✗ Image not found: {image_path}")
        return False

    try:
        payload = {
            "image_path": image_path,
            "max_tokens": 200,
            "temperature": 0.7
        }

        print(f"Analyzing: {image_path}")
        response = requests.post(
            f"{base_url}/analyze",
            json=payload,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()

        if data['success']:
            print(f"✓ Analysis successful:")
            print(f"  Description: {data['description']}")
            print(f"  Confidence: {data['confidence']:.2f}")
            return True
        else:
            print(f"✗ Analysis failed: {data.get('error', 'Unknown error')}")
            return False

    except requests.exceptions.Timeout:
        print("✗ Request timed out (inference may take a while on first run)")
        return False
    except Exception as e:
        print(f"✗ Failed: {str(e)}")
        return False


def test_analyze_base64(base_url: str, image_path: str):
    """Test the analyze endpoint with base64 image."""
    print("\n" + "="*60)
    print("Testing POST /analyze (with image_base64)")
    print("="*60)

    if not Path(image_path).exists():
        print(f"✗ Image not found: {image_path}")
        return False

    try:
        # Read and encode image
        with open(image_path, 'rb') as f:
            image_data = f.read()
            image_base64 = base64.b64encode(image_data).decode('utf-8')

        payload = {
            "image_base64": image_base64,
            "max_tokens": 200,
            "temperature": 0.7
        }

        print(f"Analyzing: {image_path} (as base64)")
        response = requests.post(
            f"{base_url}/analyze",
            json=payload,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()

        if data['success']:
            print(f"✓ Analysis successful:")
            print(f"  Description: {data['description']}")
            print(f"  Confidence: {data['confidence']:.2f}")
            return True
        else:
            print(f"✗ Analysis failed: {data.get('error', 'Unknown error')}")
            return False

    except requests.exceptions.Timeout:
        print("✗ Request timed out")
        return False
    except Exception as e:
        print(f"✗ Failed: {str(e)}")
        return False


def test_invalid_request(base_url: str):
    """Test error handling with invalid request."""
    print("\n" + "="*60)
    print("Testing POST /analyze (error handling)")
    print("="*60)

    try:
        # Send request with invalid image path
        payload = {
            "image_path": "/nonexistent/image.png"
        }

        response = requests.post(
            f"{base_url}/analyze",
            json=payload,
            timeout=10
        )

        # We expect this to fail
        if response.status_code == 500:
            print("✓ Error handling works correctly")
            print(f"  Error: {response.json().get('detail', 'Unknown')}")
            return True
        else:
            print(f"✗ Unexpected status code: {response.status_code}")
            return False

    except Exception as e:
        print(f"✗ Test failed: {str(e)}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Test FastVLM Inference Server"
    )
    parser.add_argument(
        "--host",
        type=str,
        default="localhost",
        help="Server host (default: localhost)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5123,
        help="Server port (default: 5123)"
    )
    parser.add_argument(
        "--image",
        type=str,
        help="Path to test image (required for analysis tests)"
    )

    args = parser.parse_args()

    base_url = f"http://{args.host}:{args.port}"

    print("="*60)
    print(f"FastVLM Inference Server Test Suite")
    print(f"Server: {base_url}")
    print("="*60)

    # Check if server is running
    try:
        requests.get(base_url, timeout=2)
    except requests.exceptions.ConnectionError:
        print(f"\n✗ Server not reachable at {base_url}")
        print("  Make sure the server is running:")
        print("  python server.py")
        sys.exit(1)
    except:
        pass

    # Run tests
    results = []

    # Basic endpoint tests
    results.append(("Server Info", test_root(base_url)))
    results.append(("Health Check", test_health(base_url)))
    results.append(("Error Handling", test_invalid_request(base_url)))

    # Analysis tests (only if image provided)
    if args.image:
        results.append(("Analysis (path)", test_analyze_path(base_url, args.image)))
        results.append(("Analysis (base64)", test_analyze_base64(base_url, args.image)))
    else:
        print("\n" + "="*60)
        print("Skipping analysis tests (no --image provided)")
        print("="*60)

    # Summary
    print("\n" + "="*60)
    print("Test Summary")
    print("="*60)

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")

    print(f"\nPassed: {passed}/{total}")

    if passed == total:
        print("\n✓ All tests passed!")
        sys.exit(0)
    else:
        print(f"\n✗ {total - passed} test(s) failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
