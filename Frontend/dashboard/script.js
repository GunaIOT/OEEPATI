// ==========================================
// SCRIPT.JS - FITUR EXPORT DAN LAINNYA
// Dengan handler RESET
// ==========================================

// Simulasi data produksi (menggunakan localStorage)
let productionData = {
  machine1: {
    pieces: 0,
    capacity: 8000,
    daily: 0,
    downtime: 0
  },
  machine2: {
    pieces: 0,
    capacity: 8000,
    daily: 0,
    downtime: 0
  }
};

// Load data dari localStorage jika ada
function loadProductionData() {
  const saved = localStorage.getItem('production_data');
  if (saved) {
    productionData = JSON.parse(saved);
    console.log("📦 Loaded production data from localStorage");
  } else {
    // Jika tidak ada data (baru reset), gunakan data default
    productionData = {
      machine1: { pieces: 0, capacity: 8000, daily: 0, downtime: 0 },
      machine2: { pieces: 0, capacity: 8000, daily: 0, downtime: 0 }
    };
    console.log("📦 Using default production data (after reset)");
  }
}

// Simpan data ke localStorage
function saveProductionData() {
  localStorage.setItem('production_data', JSON.stringify(productionData));
}

// Update tampilan angka produksi
function updateProductionDisplay() {
  // Mesin 1
  const el = (id) => document.getElementById(id);
  
  if (el('pieces1')) el('pieces1').innerText = productionData.machine1.pieces;
  if (el('capacity1')) el('capacity1').innerText = productionData.machine1.capacity;
  if (el('daily1')) el('daily1').innerText = productionData.machine1.daily + ' pcs';
  if (el('downtime1')) el('downtime1').innerText = productionData.machine1.downtime + ' menit';
  
  // Progress bar mesin 1
  const progress1 = (productionData.machine1.daily / productionData.machine1.capacity) * 100;
  if (el('progress1')) {
    el('progress1').style.width = progress1 + '%';
  }
  if (el('progress-percent1')) el('progress-percent1').innerText = Math.round(progress1) + '%';
  if (el('progress-text1')) el('progress-text1').innerText = Math.round(progress1) + '%';

  // Mesin 2
  if (el('pieces2')) el('pieces2').innerText = productionData.machine2.pieces;
  if (el('capacity2')) el('capacity2').innerText = productionData.machine2.capacity;
  if (el('daily2')) el('daily2').innerText = productionData.machine2.daily + ' pcs';
  if (el('downtime2')) el('downtime2').innerText = productionData.machine2.downtime + ' menit';
  
  // Progress bar mesin 2
  const progress2 = (productionData.machine2.daily / productionData.machine2.capacity) * 100;
  if (el('progress2')) {
    el('progress2').style.width = progress2 + '%';
  }
  if (el('progress-percent2')) el('progress-percent2').innerText = Math.round(progress2) + '%';
  if (el('progress-text2')) el('progress-text2').innerText = Math.round(progress2) + '%';

  // Total produksi
  const totalProduction = productionData.machine1.daily + productionData.machine2.daily;
  const totalTarget = productionData.machine1.capacity + productionData.machine2.capacity;
  const totalPercent = totalTarget > 0 ? (totalProduction / totalTarget) * 100 : 0;

  if (el('total-production')) el('total-production').innerText = totalProduction;
  if (el('total-target')) el('total-target').innerText = totalTarget;
  if (el('total-percent')) el('total-percent').innerText = Math.round(totalPercent) + '%';
}

// Simulasi update produksi otomatis (hanya jika sensor ON)
function simulateProduction() {
  const sensorState = localStorage.getItem('sensor_state');
  
  if (sensorState) {
    const data = JSON.parse(sensorState);
    
    // Hanya update jika sensor ON
    if (data.sensor_status === "ON") {
      // Random increment untuk simulasi
      if (Math.random() > 0.3) {
        productionData.machine1.pieces = Math.floor(Math.random() * 150) + 50;
        productionData.machine1.daily += Math.floor(Math.random() * 15) + 5;
      }
      
      if (Math.random() > 0.3) {
        productionData.machine2.pieces = Math.floor(Math.random() * 150) + 50;
        productionData.machine2.daily += Math.floor(Math.random() * 15) + 5;
      }
      
      // Batas maksimal jangan sampai melebihi kapasitas
      if (productionData.machine1.daily > productionData.machine1.capacity) {
        productionData.machine1.daily = productionData.machine1.capacity;
      }
      if (productionData.machine2.daily > productionData.machine2.capacity) {
        productionData.machine2.daily = productionData.machine2.capacity;
      }
      
      saveProductionData();
      updateProductionDisplay();
    }
  }
}

// Set tanggal default untuk download
const downloadDate = document.getElementById('download-date');
if (downloadDate) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  downloadDate.value = `${yyyy}-${mm}-${dd}`;
}

// Fungsi Download Excel
function downloadExcel() {
  const date = document.getElementById('download-date').value;
  const shift = document.getElementById('download-shift').value;
  
  if (!date) {
    alert('Pilih tanggal terlebih dahulu!');
    return;
  }

  // Data untuk Excel
  const excelData = [
    ['LAPORAN PRODUKSI MESIN PACKING'],
    ['Tanggal', date],
    ['Shift', shift],
    [''],
    ['Mesin', 'Pieces Terpacking', 'Kapasitas Shift', 'Total Harian', 'Operator', 'Downtime'],
    ['Mesin Packing #1', productionData.machine1.pieces, productionData.machine1.capacity, productionData.machine1.daily, 'Budi Santoso', productionData.machine1.downtime + ' menit'],
    ['Mesin Packing #2', productionData.machine2.pieces, productionData.machine2.capacity, productionData.machine2.daily, 'Siti Nurhaliza', productionData.machine2.downtime + ' menit'],
    [''],
    ['Total Produksi', '', '', productionData.machine1.daily + productionData.machine2.daily, '', ''],
    ['Target Harian', '', '', productionData.machine1.capacity + productionData.machine2.capacity, '', '']
  ];

  // Buat worksheet
  const ws = XLSX.utils.aoa_to_sheet(excelData);
  
  // Buat workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan Produksi');
  
  // Download
  const filename = `Laporan_Produksi_${date}_Shift${shift}.xlsx`;
  XLSX.writeFile(wb, filename);
  
  console.log('📥 Excel downloaded:', filename);
}

// Button untuk reset data produksi manual dari dashboard (opsional)
function manualResetProductionData() {
  if (confirm('⚠️ Reset semua data produksi?\n\nGunakan tombol RESET di Control Mesin untuk reset yang lebih baik.')) {
    productionData = {
      machine1: { pieces: 0, capacity: 8000, daily: 0, downtime: 0 },
      machine2: { pieces: 0, capacity: 8000, daily: 0, downtime: 0 }
    };
    localStorage.removeItem('production_data');
    updateProductionDisplay();
    alert('✅ Data produksi telah direset!');
  }
}

// Load data saat halaman dimuat
loadProductionData();
updateProductionDisplay();

// Jalankan simulasi setiap 3 detik
setInterval(simulateProduction, 3000);

console.log("✅ script.js loaded successfully");
