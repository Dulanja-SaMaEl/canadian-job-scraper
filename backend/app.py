import time
import requests
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_caching import Cache

app = Flask(__name__)
CORS(app)

# Configure Cache (In-memory, 10-minute TTL)
app.config['CACHE_TYPE'] = 'SimpleCache'
app.config['CACHE_DEFAULT_TIMEOUT'] = 600
cache = Cache(app)

# Headers to prevent blocking
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
}

BASE_URL = "https://www.jobbank.gc.ca/jobsearch/jobsearch"
BASE_DOMAIN = "https://www.jobbank.gc.ca"

def parse_job_article(article):
    """Parse a single job article tag into a dictionary."""
    try:
        # Job ID
        job_id = article.get("data-jobid", "")
        if not job_id and article.get("id"):
            job_id = article.get("id").replace("article-", "")

        # Link
        link_elem = article.select_one("a.resultJobItem, a")
        url = link_elem["href"] if link_elem and link_elem.has_attr("href") else ""
        if url.startswith("/"):
            url = BASE_DOMAIN + url.split(';')[0]  # Remove session ids if any

        # Title
        title_tag = article.select_one(".noctitle")
        if not title_tag:
             title_tag = article.select_one("h3")
        title = title_tag.text.strip() if title_tag else "Unknown Title"

        # Company
        company = "Unknown Company"
        company_elem = article.select_one(".business, .employer-name, .company")
        if company_elem:
            company = company_elem.text.strip()

        # Location
        location = "Unknown Location"
        location_elem = article.select_one(".location")
        if location_elem:
            for hidden in location_elem.find_all("span", class_="wb-inv"):
                hidden.decompose()
            location = " ".join(location_elem.text.split())
            
        # Salary
        salary = "Not listed"
        salary_elem = article.select_one(".salary, .pay")
        if salary_elem:
            for hidden in salary_elem.find_all("span", class_="wb-inv"):
                hidden.decompose()
            salary = " ".join(salary_elem.text.split()).replace("Salary ", "").replace("Salary", "")
            
        # Date posted
        date_posted = "Unknown Date"
        date_elem = article.select_one(".date, .date-posted")
        if date_elem:
            date_posted = date_elem.text.strip()
            
        # Extract flags (like New, On site, Direct Apply)
        flags = []
        flag_container = article.select_one(".flag")
        if flag_container:
            for span in flag_container.find_all("span", recursive=False):
                # Ignore description spans inside
                for desc in span.find_all("span", class_="description"):
                    desc.decompose()
                flag_text = span.text.strip()
                if flag_text:
                    flags.append(flag_text)

        return {
            "jobId": job_id,
            "title": title,
            "company": company,
            "location": location,
            "salary": salary,
            "datePosted": date_posted,
            "url": url,
            "flags": flags
        }
    except Exception as e:
        print(f"Error parsing article: {e}")
        return None

@app.route('/api/jobs', methods=['GET'])
@cache.cached(timeout=600, query_string=True)
def get_jobs():
    keywords = request.args.get('keywords', '')
    page = request.args.get('page', '1')
    
    # 3-second delay to avoid rate limiting
    time.sleep(3)
    
    params = {
        "searchstring": keywords,
        "fglo": "1",  # Canadians and international candidates
        "sort": "M",
        "page": page
    }
    
    try:
        response = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        jobs = []
        # Find all job articles
        articles = soup.find_all('article')
        if not articles:
            # Fallback to divs with result class
            articles = soup.select('div[class*="result"]')
            
        for article in articles:
            job_data = parse_job_article(article)
            if job_data:
                jobs.append(job_data)
                
        # Basic pagination estimation (Job Bank often doesn't give a clear total pages easy to parse,
        # but we can check if a "Next" button exists or if we got results)
        total_pages = int(page) + 1 if len(jobs) > 0 else int(page)
        
        return jsonify({
            "jobs": jobs,
            "totalPages": total_pages,
            "currentPage": int(page),
            "keyword": keywords
        })
        
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}")
        return jsonify({"error": "Failed to fetch jobs from Job Bank", "details": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
