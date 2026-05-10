"""
Generate Part 1 overview illustration for Linear Attention Tutorial.
Creates a professional diagram showing Q/K/V attention mechanism and O(N²) bottleneck.
"""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Arc
import numpy as np

# ── Style settings ────────────────────────────────────────────
plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': ['DejaVu Sans', 'Arial'],
    'font.size': 11,
    'figure.dpi': 150,
    'savefig.dpi': 150,
    'text.usetex': False,
})

# Color palette
COLORS = {
    'bg': '#0a0a1a',
    'panel_bg': '#12122a',
    'query': '#FF6B6B',
    'query_light': '#FF8E8E',
    'key': '#4ECDC4',
    'key_light': '#7EDDD6',
    'value': '#FFD93D',
    'value_light': '#FFE680',
    'attention': '#6C5CE7',
    'text': '#E8E8F0',
    'text_dim': '#8888AA',
    'accent': '#00D2FF',
    'danger': '#FF4757',
    'white': '#FFFFFF',
    'grid': '#1A1A3E',
}

def create_overview(width=16, height=10):
    """Main Part 1 overview illustration."""
    fig = plt.figure(figsize=(width, height), facecolor=COLORS['bg'])

    # ── Title area ─────────────────────────────────────────────
    ax_title = fig.add_axes([0.0, 0.93, 1.0, 0.07])
    ax_title.set_facecolor(COLORS['bg'])
    ax_title.axis('off')
    ax_title.text(0.5, 0.55, 'Part 1: Standard Softmax Attention',
                  fontsize=24, fontweight='bold', color=COLORS['white'],
                  ha='center', va='center')
    ax_title.text(0.5, 0.15, 'From Intuition to O(N²) Bottleneck',
                  fontsize=13, color=COLORS['text_dim'], ha='center', va='center')

    # ── LEFT PANEL: Library Metaphor (Q/K/V) ──────────────────
    ax_lib = fig.add_axes([0.02, 0.02, 0.30, 0.88])
    ax_lib.set_facecolor(COLORS['panel_bg'])
    ax_lib.set_xlim(0, 10)
    ax_lib.set_ylim(0, 10)
    ax_lib.axis('off')

    # Header
    ax_lib.text(5, 9.6, 'Intuition: The Library Metaphor',
                fontsize=14, fontweight='bold', color=COLORS['white'], ha='center')

    # Query (person with question)
    q_box = FancyBboxPatch((0.5, 7.2), 4.5, 1.8, boxstyle="round,pad=0.1",
                           facecolor=COLORS['query'], edgecolor='none', alpha=0.85)
    ax_lib.add_patch(q_box)
    ax_lib.text(2.75, 8.45, 'Q = Query', fontsize=13, fontweight='bold',
                color='white', ha='center')
    ax_lib.text(2.75, 7.85, '"Find books about cats"', fontsize=10,
                color='white', ha='center', alpha=0.9)
    ax_lib.text(2.75, 7.45, 'Your search question', fontsize=9,
                color='white', ha='center', alpha=0.7)

    # Arrow Q → K
    ax_lib.annotate('', xy=(7, 8.1), xytext=(5, 8.1),
                    arrowprops=dict(arrowstyle='->', color=COLORS['accent'],
                                   lw=2.5, connectionstyle='arc3,rad=0'))
    ax_lib.text(6, 8.35, 'compare', fontsize=8, color=COLORS['accent'], ha='center')

    # Keys (book labels)
    k_box = FancyBboxPatch((5.5, 6.2), 4.5, 2.2, boxstyle="round,pad=0.1",
                           facecolor=COLORS['key'], edgecolor='none', alpha=0.85)
    ax_lib.add_patch(k_box)
    ax_lib.text(7.75, 7.9, 'K = Keys', fontsize=13, fontweight='bold',
                color='white', ha='center')
    ax_lib.text(7.75, 7.3, '"Animals" "Cooking"', fontsize=10,
                color='white', ha='center', alpha=0.9)
    ax_lib.text(7.75, 6.85, '"History" "Science"', fontsize=10,
                color='white', ha='center', alpha=0.9)
    ax_lib.text(7.75, 6.45, 'Book labels to match', fontsize=9,
                color='white', ha='center', alpha=0.7)

    # Arrow K → V
    ax_lib.annotate('', xy=(2.75, 5.9), xytext=(7.75, 5.9),
                    arrowprops=dict(arrowstyle='->', color=COLORS['attention'],
                                   lw=2.5, connectionstyle='arc3,rad=0'))

    # Values (book contents)
    v_box = FancyBboxPatch((0.5, 3.8), 4.5, 1.8, boxstyle="round,pad=0.1",
                           facecolor=COLORS['value'], edgecolor='none', alpha=0.85)
    ax_lib.add_patch(v_box)
    ax_lib.text(2.75, 5.1, 'V = Values', fontsize=13, fontweight='bold',
                color='#333', ha='center')
    ax_lib.text(2.75, 4.55, 'The actual book contents', fontsize=10,
                color='#333', ha='center', alpha=0.9)
    ax_lib.text(2.75, 4.15, 'Extracted information', fontsize=9,
                color='#333', ha='center', alpha=0.7)

    # Softmax step between Q and K
    ax_lib.text(5, 6.1, 'softmax(Q·Kᵀ/√d) → attention weights',
                fontsize=9, color=COLORS['attention'], ha='center',
                fontweight='bold')

    # O(N²) warning
    warn_box = FancyBboxPatch((1, 1.8), 8, 1.5, boxstyle="round,pad=0.1",
                               facecolor=COLORS['danger'], edgecolor='none', alpha=0.2)
    ax_lib.add_patch(warn_box)
    ax_lib.text(5, 2.85, 'O(N²) BOTTLENECK',
                fontsize=14, fontweight='bold', color=COLORS['danger'], ha='center')
    ax_lib.text(5, 2.2, 'Must compare with EVERY book → N books = N×N comparisons',
                fontsize=9.5, color=COLORS['danger'], ha='center', alpha=0.9)

    # ── MIDDLE PANEL: Math Formula ──────────────────────────────
    ax_math = fig.add_axes([0.34, 0.35, 0.30, 0.55])
    ax_math.set_facecolor(COLORS['panel_bg'])
    ax_math.set_xlim(0, 10)
    ax_math.set_ylim(0, 10)
    ax_math.axis('off')

    ax_math.text(5, 9.6, 'The Math', fontsize=14, fontweight='bold',
                 color=COLORS['white'], ha='center')

    # Formula display
    formula_bg = FancyBboxPatch((0.3, 5.5), 9.4, 3.3, boxstyle="round,pad=0.15",
                                facecolor='#0d0d24', edgecolor=COLORS['accent'], lw=1.5)
    ax_math.add_patch(formula_bg)

    ax_math.text(5, 8.3, 'Attention(Q, K, V) = softmax(QKᵀ / √d) × V',
                 fontsize=13, fontweight='bold', color=COLORS['white'], ha='center',
                 fontfamily='monospace')

    # Color-coded dimensions
    ax_math.text(1.5, 7.5, '(N,d)', fontsize=10, color=COLORS['query'], ha='center',
                 fontfamily='monospace')
    ax_math.text(4.3, 7.5, '(N,d)', fontsize=10, color=COLORS['key'], ha='center',
                 fontfamily='monospace')
    ax_math.text(7.5, 7.2, '(N,N)', fontsize=10, color=COLORS['danger'], ha='center',
                 fontfamily='monospace')
    ax_math.text(9.2, 7.5, '(N,d)', fontsize=10, color=COLORS['value'], ha='center',
                 fontfamily='monospace')

    # Step breakdown
    steps = [
        ('1', 'Score: S = Q × Kᵀ', 'Shape: (N,N) — the N×N matrix'),
        ('2', 'Weights: A = softmax(S / √d)', 'Each row sums to 1 (probability dist.)'),
        ('3', 'Output: O = A × V', 'Weighted sum of values'),
    ]
    for i, (num, title, desc) in enumerate(steps):
        y = 4.8 - i * 1.3
        ax_math.text(1, y, f'[{num}]', fontsize=11, fontweight='bold',
                     color=COLORS['accent'], ha='left', fontfamily='monospace')
        ax_math.text(2.2, y, title, fontsize=11, color=COLORS['white'], ha='left',
                     fontfamily='monospace')
        ax_math.text(2.2, y - 0.45, desc, fontsize=9, color=COLORS['text_dim'], ha='left')

    # ── RIGHT PANEL: Attention Matrix ──────────────────────────
    ax_mat = fig.add_axes([0.66, 0.35, 0.32, 0.55])
    ax_mat.set_facecolor(COLORS['panel_bg'])
    ax_mat.set_xlim(0, 10)
    ax_mat.set_ylim(0, 10)
    ax_mat.axis('off')

    ax_mat.text(5, 9.6, 'The N×N Attention Matrix',
                fontsize=14, fontweight='bold', color=COLORS['white'], ha='center')

    # Generate sample attention matrix
    np.random.seed(42)
    N_display = 8
    attn = np.random.rand(N_display, N_display)
    attn = attn / attn.sum(axis=1, keepdims=True)  # normalize rows

    # Plot heatmap
    ax_heat = fig.add_axes([0.69, 0.40, 0.26, 0.42])
    im = ax_heat.imshow(attn, cmap='magma', aspect='auto', vmin=0, vmax=0.3)
    ax_heat.set_xlabel('Key position (j)', color=COLORS['text_dim'], fontsize=9)
    ax_heat.set_ylabel('Query position (i)', color=COLORS['text_dim'], fontsize=9)
    ax_heat.tick_params(colors=COLORS['text_dim'], labelsize=8)
    for i in range(N_display):
        for j in range(N_display):
            val = attn[i, j]
            color = 'white' if val > 0.15 else COLORS['text']
            ax_heat.text(j, i, f'{val:.2f}', ha='center', va='center',
                        fontsize=6.5, color=color)

    # O(N²) indicator
    ax_mat.annotate('O(N²) elements', xy=(5, 0.5), fontsize=12,
                    fontweight='bold', color=COLORS['danger'], ha='center')
    ax_mat.text(5, 0.15, 'When N=2048: 4 million entries!',
                fontsize=9, color=COLORS['text_dim'], ha='center')

    # ── BOTTOM STRIP: Key Insight ──────────────────────────────
    ax_bottom = fig.add_axes([0.34, 0.02, 0.64, 0.30])
    ax_bottom.set_facecolor(COLORS['panel_bg'])
    ax_bottom.set_xlim(0, 10)
    ax_bottom.set_ylim(0, 10)
    ax_bottom.axis('off')

    ax_bottom.text(5, 9.3, 'Why is this a problem?',
                   fontsize=14, fontweight='bold', color=COLORS['white'], ha='center')

    # Complexity comparison boxes
    sizes = [(64, '64×64', 4_096),
             (512, '512×512', 262_144),
             (2048, '2048×2048', 4_194_304)]

    for i, (n, label, ops) in enumerate(sizes):
        x = 1.2 + i * 3.2
        bar_w = 2.8
        # Box
        box = FancyBboxPatch((x, 4), bar_w, 4.5, boxstyle="round,pad=0.1",
                             facecolor=COLORS['grid'], edgecolor=COLORS['text_dim'], lw=0.8)
        ax_bottom.add_patch(box)
        ax_bottom.text(x + bar_w/2, 7.9, f'N = {n}', fontsize=11,
                       fontweight='bold', color=COLORS['white'], ha='center')
        ax_bottom.text(x + bar_w/2, 7.0, label, fontsize=10,
                       color=COLORS['text_dim'], ha='center', fontfamily='monospace')
        ax_bottom.text(x + bar_w/2, 6.2, f'{ops:,} ops', fontsize=10,
                       color=COLORS['danger'] if n > 100 else COLORS['accent'],
                       ha='center', fontfamily='monospace')

        # Visual bar representing O(N²)
        bar_height = 1.5 * (n / 2048)
        bar = FancyBboxPatch((x + 0.3, 4.3), bar_w - 0.6, bar_height,
                             boxstyle="round,pad=0.05",
                             facecolor=COLORS['danger'] if n > 100 else COLORS['accent'],
                             edgecolor='none', alpha=0.6)
        ax_bottom.add_patch(bar)

    ax_bottom.text(5, 3.2, 'Quadratic growth → compute & memory explode with long sequences',
                   fontsize=10, color=COLORS['text_dim'], ha='center')
    ax_bottom.text(5, 2.3, '→ Next: Linear Attention solves this with O(N) complexity',
                   fontsize=11, fontweight='bold', color=COLORS['accent'], ha='center')

    # ── Footer ──────────────────────────────────────────────────
    ax_footer = fig.add_axes([0.0, 0.0, 1.0, 0.02])
    ax_footer.set_facecolor(COLORS['bg'])
    ax_footer.axis('off')

    plt.savefig('/mnt/esfs/master_work/linear_attention/images/part1_overview.png',
                facecolor=COLORS['bg'], edgecolor='none', bbox_inches='tight',
                pad_inches=0.3)
    print('Saved: part1_overview.png')
    plt.close()

def create_attention_micro():
    """A compact version for inline display."""
    fig, axes = plt.subplots(1, 3, figsize=(14, 4.5), facecolor=COLORS['bg'])

    # Panel 1: Q/K/V
    ax = axes[0]
    ax.set_facecolor(COLORS['panel_bg'])
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')
    ax.set_title('Step 1: Q·Kᵀ → Scores', color='white', fontweight='bold', fontsize=12)

    for i, (label, color, y) in enumerate([('Q (N,d)', COLORS['query'], 8),
                                            ('×', COLORS['text'], 6.5),
                                            ('Kᵀ (d,N)', COLORS['key'], 5)]):
        ax.text(5, y, label, fontsize=13, fontweight='bold', color=color,
                ha='center', fontfamily='monospace')
    ax.text(5, 3, '= Scores (N,N)', fontsize=12, color=COLORS['danger'],
            ha='center', fontfamily='monospace')
    ax.text(5, 1.5, 'O(N²) computation', fontsize=10, color=COLORS['danger'], ha='center')

    # Panel 2: Softmax
    ax = axes[1]
    ax.set_facecolor(COLORS['panel_bg'])
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')
    ax.set_title('Step 2: softmax(·/√d) → Weights', color='white', fontweight='bold', fontsize=12)

    ax.text(5, 7, 'Scores (N,N)', fontsize=12, color=COLORS['danger'],
            ha='center', fontfamily='monospace')
    ax.annotate('', xy=(5, 5.8), xytext=(5, 6.5),
                arrowprops=dict(arrowstyle='->', color=COLORS['accent'], lw=2))
    ax.text(5, 5, 'Weights (N,N)', fontsize=12, color=COLORS['attention'],
            ha='center', fontfamily='monospace')
    ax.text(5, 3.5, 'Each row = probability distribution', fontsize=9,
            color=COLORS['text_dim'], ha='center')
    ax.text(5, 2.5, 'Σᵢ = 1.0', fontsize=10, color=COLORS['text_dim'],
            ha='center', fontfamily='monospace')

    # Panel 3: Output
    ax = axes[2]
    ax.set_facecolor(COLORS['panel_bg'])
    ax.set_xlim(0, 10); ax.set_ylim(0, 10); ax.axis('off')
    ax.set_title('Step 3: A·V → Output', color='white', fontweight='bold', fontsize=12)

    ax.text(5, 8, 'Weights (N,N)', fontsize=12, color=COLORS['attention'],
            ha='center', fontfamily='monospace')
    ax.text(5, 7, '×', fontsize=11, color=COLORS['text'], ha='center')
    ax.text(5, 6, 'Values (N,d)', fontsize=12, color=COLORS['value'],
            ha='center', fontfamily='monospace')
    ax.text(5, 4.5, '= Output (N,d)', fontsize=13, fontweight='bold',
            color=COLORS['accent'], ha='center', fontfamily='monospace')
    ax.text(5, 3, 'Weighted combination of values', fontsize=10,
            color=COLORS['text_dim'], ha='center')

    plt.tight_layout()
    out = '/mnt/esfs/master_work/linear_attention/images/attention_steps.png'
    plt.savefig(out, facecolor=COLORS['bg'], bbox_inches='tight')
    print(f'Saved: {out}')
    plt.close()

if __name__ == '__main__':
    import os
    os.makedirs('/mnt/esfs/master_work/linear_attention/images', exist_ok=True)
    create_overview()
    create_attention_micro()
    print('Done!')
