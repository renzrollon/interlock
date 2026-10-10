using Acme.Core;
using System.Text;
global using Acme.Core;
using static Acme.Core.Units;
using Metrics = Acme.Core.Metrics;

namespace Acme.App;

public class Dashboard
{
    public void Render()
    {
        using var stream = Open();
        var source = new DeviceMetricSource();
        var sb = new StringBuilder();
    }
}
